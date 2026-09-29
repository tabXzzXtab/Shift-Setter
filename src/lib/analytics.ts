import type { Role } from "@/lib/account";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Silent analytics: time on screen and taps, per screen and role.
 *
 * WHAT A ROW CARRIES. A screen path, a role, and -- for a tap -- the kind of
 * element and where it was. No account id: the table has no column for one
 * (migration 20260929100000). No text: a button's label here is often a
 * person's or a project's name, so an element is described by its tag or role
 * and a `data-analytics` key, and the database refuses anything that is not an
 * identifier. No query string: that is where this app carries ids.
 *
 * WHO IS NOT RECORDED. The operator -- refused by the database whatever this
 * file does, and skipped here so it does not send rows to be refused -- and
 * automated browsers, which the database cannot tell from people. The
 * analytics walkthrough opts back in with ANALYTICS_TEST_KEY.
 *
 * GENTLE ON A PHONE ON A BUILDING SITE. Events are buffered and sent together:
 * every 10 s, at 25 events, or when the page is hidden. The last send as the
 * app goes away uses fetch keepalive, because a normal request is cancelled
 * with the page. If even that is lost, the visit's exit is lost with it, and
 * the averages simply do not count that visit -- the duration travels on the
 * exit, so a missing exit can never read as an endless one.
 *
 * NOTHING HERE MAY BREAK THE APP. Every failure is swallowed; a refusal from
 * the database switches recording off for the rest of the page's life.
 */

export const ANALYTICS_TEST_KEY = "byggkoll.analytics-test";

const FLUSH_MS = 10_000;
const FLUSH_AT = 25;

type Row = {
  role: Role;
  kind: "screen_enter" | "screen_exit" | "tap";
  screen: string;
  visit_id: string;
  client_at: string;
  duration_ms?: number;
  element?: string;
  x?: number;
  y?: number;
  vw?: number;
  vh?: number;
  scroll_y?: number;
};

let buffer: Row[] = [];
let off = false;
let timer: number | undefined;
/** The latest access token, kept for the send that cannot wait for one. */
let token: string | null = null;

export function setAnalyticsToken(t: string | null) {
  token = t;
}

export function analyticsOff() {
  off = true;
  buffer = [];
}

/** Automated browsers are not people, unless the analytics walkthrough says so. */
export function automatedWithoutOptIn(): boolean {
  try {
    if (!navigator.webdriver) return false;
    return window.localStorage.getItem(ANALYTICS_TEST_KEY) !== "1";
  } catch {
    return false;
  }
}

/**
 * The path as the database accepts it: lower case, no trailing slash, no
 * query. Anything else a path could hold (a character outside a-z 0-9 / -)
 * is not a screen of this app, and is not recorded.
 */
export function screenOf(pathname: string): string | null {
  const p = pathname.split("?")[0]!.toLowerCase().replace(/\/+$/, "") || "/";
  return /^\/[a-z0-9/-]*$/.test(p) && p.length <= 80 ? p : null;
}

const INTERACTIVE =
  'a, button, [role="button"], [role="link"], [role="checkbox"], [role="tab"], ' +
  "input, select, textarea, label, summary, [data-analytics]";

/**
 * What was tapped, without a word of what it says.
 *
 * The nearest control's tag or ARIA role, plus the nearest data-analytics key
 * when a screen gives one ("button:stampla-in"). Keys are cleaned to the
 * identifier alphabet the database enforces, so a mistyped key costs its
 * detail rather than the whole event. A tap on no control at all is "none" --
 * a heatmap wants those too, they are where people expected something to be.
 */
export function elementOf(target: EventTarget | null): string {
  const el = target instanceof Element ? target.closest(INTERACTIVE) : null;
  if (!el) return "none";
  const kind = (el.getAttribute("role") || el.tagName).toLowerCase().replace(/[^a-z0-9]/g, "");
  const raw = el.closest("[data-analytics]")?.getAttribute("data-analytics") ?? "";
  const key = raw.toLowerCase().replace(/[^a-z0-9:._-]/g, "-").replace(/-+/g, "-").slice(0, 60);
  return (key ? `${kind}:${key}` : kind || "none").slice(0, 80);
}

export function record(row: Row) {
  if (off) return;
  buffer.push(row);
  if (buffer.length >= FLUSH_AT) void flush();
  else if (timer === undefined) timer = window.setTimeout(() => void flush(), FLUSH_MS);
}

/** Send what is buffered. `leaving`: the page is going away; use keepalive. */
export async function flush(leaving = false) {
  if (timer !== undefined) { window.clearTimeout(timer); timer = undefined; }
  if (off || buffer.length === 0) return;
  const rows = buffer;
  buffer = [];

  try {
    if (leaving) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key || !token) return;
      void fetch(`${url}/rest/v1/analytics_event`, {
        method: "POST",
        keepalive: true,
        headers: {
          apikey: key,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(rows),
      }).catch(() => {});
      return;
    }
    const { error } = await getSupabase().from("analytics_event").insert(rows);
    // Refused by policy: this session is not one the table records (the
    // operator, a paused account, an expired tenancy). Stop asking.
    if (error && (error.code === "42501" || /row-level security/i.test(error.message))) analyticsOff();
  } catch {
    /* never the app's problem */
  }
}
