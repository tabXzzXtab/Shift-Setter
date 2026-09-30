/**
 * Open one day, the way the calendars now open it -- and, when a project is
 * named, that project's day, where the controls on its passes live.
 *
 * The day is a timeline at /dag?datum= : every pass and ärende as a block,
 * nothing to act on. Tapping a pass's block opens /dag/projekt?datum=&projekt=,
 * the project's day (DagPanel scoped to it), which carries the trash icons,
 * Avboka Pass, Byta Plats, Ändra detta pass and Ta bort detta pass. So a suite
 * reaching for one of those names the project, and this taps its block.
 *
 * Goes straight to the URL rather than paging the calendar to the right month
 * and tapping. Proving that a tap navigates is walkthrough-kalender's job.
 *
 * `project` is optional. Unnamed, a day holding exactly one project opens that
 * project's day (as the old single-project page showed its controls outright);
 * otherwise, and when the named project has no block on the day -- which is
 * exactly what several of these suites are checking for -- the day screen
 * itself stays open, and it says "Inställd dag" when the day was emptied.
 */
export async function openDayPage(page, base, date, project) {
  await page.goto(`${base}/dag/?datum=${date}`, { waitUntil: "networkidle" });
  const day = page.locator(`[data-day-timeline="${date}"]`);
  await day.waitFor({ timeout: 20000 });

  const blocks = page.locator("[data-pass-block]");
  let name = project;
  if (!name) {
    const names = new Set(await blocks.evaluateAll((els) => els.map((e) => e.getAttribute("data-block-project"))));
    if (names.size !== 1) return;
    name = [...names][0];
  }
  const block = page.locator(`[data-block-project="${name}"]`).first();
  if (!(await block.count())) return;
  await block.click();
  const panel = page.locator(`[data-day-panel="${date}"]`);
  await panel.waitFor({ timeout: 20000 });
  // The panel renders before its shifts arrive: wait for the loading line to go.
  await panel.getByText("Laddar…", { exact: true }).waitFor({ state: "detached", timeout: 20000 });
}

/**
 * Show one project's passes on the day already open.
 *
 * The day used to hold every project behind tabs on one page; each project's
 * passes are their own screen now, so this re-opens the current date with that
 * project named. A project with no block on the day is a no-op, as a missing
 * tab was.
 */
export async function chooseProject(page, project) {
  const url = new URL(page.url());
  const date = url.searchParams.get("datum");
  if (!date) return;
  await openDayPage(page, url.origin, date, project);
}
