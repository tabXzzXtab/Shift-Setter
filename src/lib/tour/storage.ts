/**
 * Where the first-launch tour remembers itself: this browser, per account.
 *
 * localStorage, so it is per DEVICE. A new phone, or a browser whose site data
 * was cleared, plays the tour again. That is the chosen trade -- nothing about
 * the tour is worth a table -- and it is why every read and write here is
 * wrapped: a private window or blocked storage throws on access, and a tour
 * that cannot remember must still let the app underneath work.
 *
 * THE FIRST VISIT IS THE ONE THAT COUNTS. `onboarding_complete_{id}` is set
 * in localStorage the moment the tour STARTS, not when "Kom igång" is pressed:
 * a person who closed the app halfway had it back on every later visit, which
 * read as a tour that never remembered them. The step to resume at lives in
 * sessionStorage instead, so a reload in the same session carries on where it
 * was, and a new visit does not bring it back. Guide (menu) replays it on
 * request.
 */

const completeKey = (accountId: string) => `onboarding_complete_${accountId}`;
const stepKey = (accountId: string) => `onboarding_step_${accountId}`;

/** Set by the tour's own walkthrough. See the note on AUTOMATED BROWSERS. */
export const TOUR_TEST_KEY = "byggkoll.tour-test";

export function tourComplete(accountId: string): boolean {
  try {
    return window.localStorage.getItem(completeKey(accountId)) === "1";
  } catch {
    // Unreadable storage cannot remember a finished tour either, and replaying
    // it on every load would be worse than not showing it: treat it as done.
    return true;
  }
}

/** The step to resume at in THIS session, or null when none is running. */
export function sessionStep(accountId: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(stepKey(accountId));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return null;
  }
}

export function saveStep(accountId: string, step: number) {
  try { window.sessionStorage.setItem(stepKey(accountId), String(step)); } catch { /* private mode */ }
}

/** Starting counts as seen: the tour will not open by itself again. */
export function markSeen(accountId: string) {
  try { window.localStorage.setItem(completeKey(accountId), "1"); } catch { /* private mode */ }
  // An older build kept the step here; it would otherwise linger forever.
  try { window.localStorage.removeItem(stepKey(accountId)); } catch { /* private mode */ }
}

export function completeTour(accountId: string) {
  markSeen(accountId);
  try { window.sessionStorage.removeItem(stepKey(accountId)); } catch { /* private mode */ }
}

/** Guide: play the tour again from the first step, in this session. */
export function requestReplay(accountId: string) {
  try { window.sessionStorage.setItem(stepKey(accountId), "0"); } catch { /* private mode */ }
}

/**
 * AUTOMATED BROWSERS DO NOT GET THE TOUR, unless they ask for it.
 *
 * Every walkthrough in scripts/ signs a demo account into a fresh browser
 * context, which is a first launch with empty storage every single time. A
 * full-screen card over the first screen would stop all of them at their first
 * click. navigator.webdriver is what Playwright sets; the tour's own
 * walkthrough sets TOUR_TEST_KEY before the page loads to opt back in.
 */
export function automatedWithoutOptIn(): boolean {
  try {
    if (!navigator.webdriver) return false;
    return window.localStorage.getItem(TOUR_TEST_KEY) !== "1";
  } catch {
    return false;
  }
}
