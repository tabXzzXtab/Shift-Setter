/**
 * Where the first-launch tour remembers itself: this browser, per account.
 *
 * localStorage, so it is per DEVICE. A new phone, or a browser whose site data
 * was cleared, plays the tour again. That is the chosen trade -- nothing about
 * the tour is worth a table -- and it is why every read and write here is
 * wrapped: a private window or blocked storage throws on access, and a tour
 * that cannot remember must still let the app underneath work.
 *
 * Two keys. `onboarding_complete_{id}` is set once, by "Kom igång", and ends
 * the tour for good on this device. `onboarding_step_{id}` is the step to
 * resume at, so a reload in the middle does not start again from the first
 * card -- it is removed when the tour completes.
 */

const completeKey = (accountId: string) => `onboarding_complete_${accountId}`;
const createdKey = (accountId: string) => `onboarding_created_${accountId}`;
const stepKey = (accountId: string) => `onboarding_step_${accountId}`;

/**
 * What the tour created, so "Kom igång" can take it away again: the admin's
 * example project is a sandbox, not a real project. Kept per account on this
 * device, beside the step, so a tour resumed after a reload still cleans up.
 */
export type TourRow = { kind: "project"; id: string };

export function rememberCreated(accountId: string, row: TourRow) {
  try {
    const rows = createdRows(accountId).filter((r) => r.id !== row.id);
    window.localStorage.setItem(createdKey(accountId), JSON.stringify([...rows, row]));
  } catch { /* private mode: nothing to clean up later, and nothing breaks */ }
}

export function createdRows(accountId: string): TourRow[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(createdKey(accountId)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((r) => r?.kind === "project" && typeof r.id === "string") : [];
  } catch {
    return [];
  }
}

export function forgetCreated(accountId: string, keep: TourRow[] = []) {
  try {
    if (keep.length) window.localStorage.setItem(createdKey(accountId), JSON.stringify(keep));
    else window.localStorage.removeItem(createdKey(accountId));
  } catch { /* private mode */ }
}

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

export function savedStep(accountId: string): number {
  try {
    const n = Number(window.localStorage.getItem(stepKey(accountId)));
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveStep(accountId: string, step: number) {
  try { window.localStorage.setItem(stepKey(accountId), String(step)); } catch { /* private mode */ }
}

export function completeTour(accountId: string) {
  try {
    window.localStorage.setItem(completeKey(accountId), "1");
    window.localStorage.removeItem(stepKey(accountId));
  } catch { /* private mode */ }
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
