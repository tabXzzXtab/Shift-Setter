/**
 * Open one day's page, the way the shift calendar now opens it.
 *
 * Two things changed underneath every walkthrough that used to tap a day in the
 * calendar and read the panel that unfolded below the grid:
 *
 *   1. The day is its own page at /dag?datum= . Tapping a cell navigates.
 *   2. That page shows ONE project at a time. On a day holding two sites, the
 *      other one's controls are not off-screen -- they are not rendered. Any
 *      suite reaching for a control on a particular project has to name it.
 *
 * Goes straight to the URL rather than paging the calendar to the right month
 * and tapping. Proving that a tap navigates is walkthrough-kalender's job;
 * repeating it in five other suites only gives the month paging five more
 * places to go wrong, in tests that are about something else entirely.
 *
 * `project` is optional. A day holding one project has no tabs at all, and that
 * is not a failure -- so is a day where the named project has no shifts left,
 * which is exactly what several of these suites are checking for.
 */
export async function openDayPage(page, base, date, project) {
  await page.goto(`${base}/dag/?datum=${date}`, { waitUntil: "networkidle" });
  const panel = page.locator(`[data-day-panel="${date}"]`);
  await panel.waitFor({ timeout: 20000 });

  // The panel renders before its shifts arrive, so the wrapper appearing is not
  // the day being ready. Waiting for the loading line to go covers the empty
  // day and the cancelled one as well as the ordinary case.
  await panel.getByText("Laddar…", { exact: true })
    .waitFor({ state: "detached", timeout: 20000 });

  if (project) await chooseProject(page, project);
}

/**
 * Bring one project's tab to the front of a day that is already open.
 *
 * A missing tab is a no-op, not a failure: a day holding one project has no
 * tab strip at all. So is a day where the named project has no shifts left,
 * which is what several of these suites are checking for.
 *
 * Waits for the tab rather than counting it once. The panel keeps showing the
 * previous date while the new one loads -- the date picker does not blank it --
 * so a caller that has just typed a date would otherwise look for the tabs
 * before they exist and silently read the wrong day.
 */
export async function chooseProject(page, project) {
  const tab = page.locator(`[data-project-tab="${project}"]`);
  try {
    await tab.waitFor({ timeout: 5000 });
  } catch {
    return;
  }
  await tab.click();
  await page.waitForTimeout(400);
}
