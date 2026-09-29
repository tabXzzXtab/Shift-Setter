/**
 * Dates for a walkthrough run, and the calendar paging that reaches them.
 *
 * WHY THIS EXISTS. The walkthroughs write real rows on dates computed from
 * today, and they never clean up. Run the suite twice and the second run meets
 * the first run's data: 2026-09-27 reached 24 projects and 28 passes across a
 * handful of sweeps, and `snabb` -- which has to pick its own project out of
 * that day -- failed on a day it had passed on hours earlier. `pausa` failed
 * the same way, its day page reporting "2 projekt den här dagen", one from each
 * sweep.
 *
 * So a run takes a LANE: an offset derived from the run stamp the scripts
 * already carry, which moves this run's dates off the last one's.
 * Deterministic, no state on disk, no coordination between scripts.
 *
 * WHAT IT DOES NOT DO, said plainly so nobody trusts it further than it goes:
 * it delays collisions, it does not remove rows. The pool of days is finite and
 * every sweep fills more of it. `npm run demo:reset` before a sweep is what
 * clears the slate; this is what keeps a sweep run WITHOUT one from landing on
 * top of the last.
 */

/** Today in Stockholm, as YYYY-MM-DD. Invariant 9: never the server default. */
export function stockholmToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" })
    .format(new Date());
}

/**
 * n days from a YYYY-MM-DD date, as YYYY-MM-DD.
 *
 * Built at NOON UTC rather than by adding 864e5 to a timestamp. Adding
 * milliseconds is wrong twice a year: across the March and October changes a
 * "+1 day" of 86 400 000 ms lands on the same calendar day or skips one, so a
 * script doing it that way picks a different day than the one it prints.
 * Noon is far enough from either boundary that no zone shifts the date.
 */
export function shiftDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

/** Whether two YYYY-MM-DD dates fall in the same calendar month. */
export function sameMonth(a, b) {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * An UNBOUNDED lane: 0 .. span-1, chosen by the run.
 *
 * For scripts that page the calendar, and for ones working in days already
 * past, where the only ceiling is how far back a fixture may sensibly reach.
 *
 * The run stamp is the last six digits of Date.now(), so two sweeps minutes
 * apart differ by thousands and land far apart in the modulus rather than
 * next door to each other.
 */
export function runLane(run, span) {
  return Number(run) % span;
}

/**
 * An IN-MONTH lane: an offset that keeps a block of future days inside the
 * month the calendar already has on screen.
 *
 * `ahead` is the furthest day forward the script needs. When the month has
 * room for that block plus slack, the lane spreads the run across the slack.
 * When it does not -- the last days of a month -- it returns 0 and the dates
 * fall where they always did, into next month.
 *
 * That is not a failure, and this is deliberately not a guard. The scripts
 * using it page the calendar, so crossing is handled; keeping the common case
 * on the month already drawn just saves the paging. A lane that refused to
 * cross would turn the last week of every month into a red suite.
 */
export function monthLane(run, ahead, today = stockholmToday()) {
  const [y, m, d] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  const room = daysInMonth - d - ahead;
  if (room <= 0) return 0;
  return runLane(run, room + 1);
}

/**
 * Page a calendar until the date is on screen.
 *
 * Every calendar in the app -- MonthGrid and PaintCalendar alike -- draws its
 * chrome with the shared MonthCard, so both carry these two buttons and both
 * can be walked a month at a time. This is what lets `ledare` and `arbetare`
 * reach a date in another month at all: before it they waited 20 seconds for a
 * cell that was never going to render, then failed with a locator timeout that
 * said nothing about what had gone wrong.
 *
 * Bounded at 24 months, and the direction is decided once from the target
 * rather than probed, so a wrong guess cannot walk away from the date forever.
 * `fail` is passed in because each script owns how it reports and screenshots.
 */
export async function reachDate(page, date, fail) {
  for (let i = 0; i < 24; i++) {
    if (await page.locator(`[data-date="${date}"]`).count()) return;

    // WHICH WAY TO WALK IS READ OFF THE SCREEN, not worked out from today.
    //
    // Deciding it from today is right only while the calendar is still showing
    // the current month, which holds if every call follows a fresh page.goto
    // and breaks the moment two calls share one page load: after paging
    // forward to November, a request for a date in October is still "after
    // today", so it would page forward again and walk 24 months away from a
    // date that was one click back. walkthrough-tiers picks several days on
    // one load and was avoiding this by visiting them in ascending order --
    // a constraint nobody should have to know about, found by shift-project-
    // setterv2-5c rather than by me.
    //
    // Compared against the whole span on screen rather than one cell, because
    // a month grid may also draw the tail of the previous month or the head of
    // the next; the target is known not to be among them, since the check
    // above just failed.
    const shown = await page.locator("[data-date]").evaluateAll(
      (els) => els.map((e) => e.getAttribute("data-date")).filter(Boolean).sort());
    if (!shown.length) fail(`no calendar on screen to page towards ${date}`);

    const name = date > shown[shown.length - 1] ? "Nästa månad" : "Föregående månad";
    const button = page.getByRole("button", { name, exact: true });
    if (!(await button.count())) {
      fail(`${date} is not on screen and this calendar has no "${name}" button`);
    }
    await button.click();
    await page.waitForTimeout(400);
  }
  fail(`could not page the calendar to ${date} in 24 months`);
}
