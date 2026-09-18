"use client";

import { Capacitor } from "@capacitor/core";
import { getSupabase } from "./supabase/client";

/**
 * Push notifications, the half that runs on the device.
 *
 * NOTHING HERE SENDS ANYTHING. Sending needs the APNs and FCM credentials,
 * which are server-side secrets, which on a static export means a Supabase
 * Edge Function (CLAUDE.md). This registers the handset and files the token;
 * what wakes it is somebody else's job.
 *
 * EVERY FUNCTION IS A NO-OP IN A BROWSER, and that is not defensive
 * programming -- it is the app's actual shape. The same build serves
 * app.bellaserviceab.se and loads inside the Capacitor shell (capacitor.config
 * .ts points the WebView at that origin), so every one of these runs on the
 * web far more often than on a phone. @capacitor/push-notifications has no web
 * implementation at all: calling register() there throws "not implemented",
 * which would be an unhandled rejection on the worker's home screen for the
 * majority of users. So the platform check comes first, every time.
 *
 * THE PLUGIN IS IMPORTED LAZILY for the same reason. A static import pulls the
 * plugin into the main bundle for a browser that can never use it, and its
 * module-level registration runs on a page that has no native bridge.
 */

/** ios or android -- the two the plugin can actually register on. */
export type PushPlatform = "ios" | "android";

/**
 * Can this runtime register for push at all?
 *
 * Both halves matter. isNativePlatform() is false in every browser, and the
 * platform name is checked because the table's constraint accepts exactly
 * these two: a third would be refused by the database after the OS had already
 * asked the user for permission, which is the worst order to discover it in.
 */
export function pushPlatform(): PushPlatform | null {
  if (!Capacitor.isNativePlatform()) return null;
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android" ? p : null;
}

/** What the OS currently thinks, without asking. */
export type PushPermission = "granted" | "denied" | "prompt" | "unavailable";

async function plugin() {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  return PushNotifications;
}

/**
 * What permission stands right now. Never prompts.
 *
 * Separate from requestPermission() because the two are different questions
 * and the worker's home screen asks both: it wants to know whether to prompt
 * before it prompts, and a check that silently prompted would put a system
 * dialog in front of somebody who opened the app to clock in.
 */
export async function checkPermission(): Promise<PushPermission> {
  if (!pushPlatform()) return "unavailable";
  try {
    const { receive } = await (await plugin()).checkPermissions();
    return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
  } catch {
    return "unavailable";
  }
}

/**
 * Ask the OS for permission.
 *
 * ONCE EVER, AND THE OS MEANS IT. On iOS the system dialog is shown exactly
 * one time per install: after that requestPermissions() returns the standing
 * answer without showing anything. So a denial cannot be undone from inside
 * the app -- only from Settings -- which is why the worker's home screen
 * explains rather than asking twice.
 */
export async function requestPermission(): Promise<PushPermission> {
  if (!pushPlatform()) return "unavailable";
  try {
    const { receive } = await (await plugin()).requestPermissions();
    return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
  } catch {
    return "unavailable";
  }
}

/**
 * Register the handset and file its token against the signed-in account.
 *
 * THE TOKEN ARRIVES ON AN EVENT, not from the call. register() only asks APNs
 * or FCM to start; the string comes back later on a 'registration' listener,
 * or not at all if the device is offline or the app is misconfigured. So this
 * waits for it, and gives up rather than hanging -- a promise that never
 * settles would sit in the home screen's effect forever.
 *
 * IT DOES NOT PROMPT. Permission is the caller's decision to ask for, because
 * the caller is the one that knows whether now is a reasonable moment. This
 * registers only if permission already stands, which makes it safe to call on
 * every login for every role -- including the two roles that are never asked.
 *
 * Returns the token it filed, or null if nothing was filed. Never throws: a
 * failure here means the phone will not ring, which is worth reporting to a
 * log and not worth breaking a screen over.
 */
export async function registerToken(): Promise<string | null> {
  const platform = pushPlatform();
  if (!platform) return null;

  try {
    const push = await plugin();
    if ((await push.checkPermissions()).receive !== "granted") return null;

    const token = await new Promise<string | null>((resolve) => {
      let settled = false;
      const done = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      // Both outcomes, and a deadline. Without the error listener a
      // misconfigured APNs entitlement is indistinguishable from a slow
      // network, and both would spend the full timeout.
      void push.addListener("registration", (t) => done(t.value));
      void push.addListener("registrationError", () => done(null));
      setTimeout(() => done(null), 15_000);

      void push.register();
    });

    if (!token) return null;

    // The account is auth.uid() inside the function -- deliberately not a
    // parameter, so a caller cannot point somebody else's notifications at
    // this handset.
    const { error } = await getSupabase()
      .rpc("register_push_token", { p_token: token, p_platform: platform });
    if (error) return null;

    return token;
  } catch {
    return null;
  }
}

/**
 * Hand the device back on the way out.
 *
 * Called from the sign-out button BEFORE the session goes, because the delete
 * is scoped to auth.uid() in the database and there is no caller to scope it
 * to afterwards.
 *
 * Scoped that way on purpose: on a shared handset the row belongs to whoever
 * signed in last, so somebody signing out on their own phone must not silence
 * a site phone that has since been claimed by the person now holding it. The
 * delete simply matches nothing in that case, which is correct.
 *
 * Never throws, for the same reason as above: a sign-out that failed because a
 * token could not be filed away would be a person stuck signed in.
 */
export async function forgetToken(): Promise<void> {
  if (!pushPlatform()) return;
  try {
    const push = await plugin();
    // What the OS holds, rather than anything remembered: the token can be
    // rotated by the platform between launches, and the row to delete is the
    // one this device is actually addressed by now.
    const token = await new Promise<string | null>((resolve) => {
      let settled = false;
      const done = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
      void push.addListener("registration", (t) => done(t.value));
      void push.addListener("registrationError", () => done(null));
      setTimeout(() => done(null), 5_000);
      void push.register();
    });

    if (token) await getSupabase().rpc("forget_push_token", { p_token: token });
  } catch {
    // Nothing to do. The next person to sign in on this handset takes the row.
  }
}
