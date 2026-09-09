#!/usr/bin/env node
/**
 * The shift calendar in a browser.
 *
 * What it proves:
 *   - every project on a calendar day is a colour stripe, sampled from the page
 *   - EVERY DAY CELL IS THE SAME HEIGHT, on a month holding five projects and a
 *     day holding all five at once. A cell that grew a line per project is the
 *     failure this replaced.
 *   - past four projects the rest become "+N", and the arithmetic is checked
 *     against the count the cell declares
 *   - the grid carries no project names -- the legend below it does
 *   - tapping a day NAVIGATES to /dag?datum=, it does not expand in place
 *   - the day page tabs through the projects one at a time, and each tab wears
 *     the same colour that project wore on the calendar
 *   - an arbetsledare sees only their own project; an arbetare is turned away
 *   - only the admin can delete a pass
 *   - an ongoing pass cannot be deleted
 *   - deleting a future one notifies the worker, and it leaves their list
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";
import { chooseProject } from "./day-page.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/Shift-Setter";
const ART = "artifacts";
const RUN = Date.now().toString().slice(-6);
mkdirSync(ART, { recursive: true });

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };

const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();
const shot = (page, name) => page.screenshot({ path: path.join(ART, `${name}.png`), fullPage: true });

async function mustSee(page, text, why) {
  try { await page.getByText(text, { exact: false }).first().waitFor({ timeout: 25000 }); }
  catch {
    await shot(page, "FAILED-kalender");
    const seen = await page.locator("main, body").first().innerText().catch(() => "(nothing)");
    fail(`${why} (never saw "${text}")\n--- screen ---\n${seen.slice(0, 700)}`);
  }
}
async function mustNotSee(page, text, why) {
  await page.waitForTimeout(1000);
  if (await page.getByText(text, { exact: false }).count()) {
    await shot(page, "FAILED-kalender"); fail(`${why} (saw "${text}")`);
  }
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await page.locator("form").waitFor({ timeout: 20000 });
  await field(page, "E-post").fill(email);
  await field(page, "Lösenord").fill(password);
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.waitForLoadState("networkidle");
}
async function signOut(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  // Since the landing pages were rebuilt, Logga ut lives behind the profile
  // icon on every role that has one.
  if (!(await page.getByRole("button", { name: "Logga ut" }).count())) {
    await page.getByRole("button", { name: "Profil", exact: true }).click();
  }
  await page.getByRole("button", { name: "Logga ut" }).click();
  await page.waitForURL(/login/, { timeout: 20000 });
}
async function createPerson(page, name, email, role) {
  await page.goto(`${BASE}/arbetare/ny/`, { waitUntil: "networkidle" });
  await field(page, "Namn").fill(name);
  await field(page, "E-post").fill(email);
  await field(page, "Roll").selectOption(role);
  await page.getByRole("button", { name: /Kopiera inloggning/ }).click();
  const password = (await page.locator("[data-password]").first().innerText()).trim();
  if (!password) fail(`no password for ${name}`);
  await page.getByRole("button", { name: "Tillverka arbetare" }).click();
  await page.getByText("Klar", { exact: false }).first().waitFor({ timeout: 20000 });
  return { email, password, name };
}
async function createProject(page, name, leaderLabel, today) {
  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  await field(page, "Projektnamn").fill(name);
  await field(page, "Projektets adress").fill("Bruksgatan 8, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Bygg");
  await field(page, "Startdatum").fill(today);
  await field(page, "Arbetsledare").selectOption({ label: leaderLabel });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
}
async function tapDay(page, date) {
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.waitFor({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(500);
}

/**
 * A day on the SHIFT CALENDAR now leaves the page.
 *
 * The panel used to unfold underneath the grid; it is its own page reached at
 * /dag?datum= . Waiting on the URL rather than on a timeout is what makes this
 * a test of the navigation instead of a test of how fast the machine is.
 */
async function openDay(page, date) {
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
  await tapDay(page, date);
  await page.waitForURL((u) => u.pathname.includes("/dag") && u.search.includes(date), {
    timeout: 20000,
  });
  await page.waitForLoadState("networkidle");
  await page.locator(`[data-day-panel="${date}"]`).waitFor({ timeout: 20000 });
  // The panel renders before its shifts arrive, so the wrapper appearing is
  // not the day being ready. Wait for a pass card -- every day this walkthrough
  // opens has one, and asserting against the loading state is how a check for
  // something the page will show in 200ms fails for no reason at all.
  await page.locator(`[data-day-panel="${date}"] section`).first().waitFor({ timeout: 20000 });
}

/**
 * `pick` hand-picks a worker into the batch.
 *
 * Without it the slot goes to whoever the priority list ranks first, and this
 * database holds every worker the other walkthroughs have ever created -- some
 * of whom have marked these very dates. The deletion notification asserted at
 * the end is addressed to ONE worker, so which worker holds the shift cannot
 * be left to a ranking that changes with the calendar. Hand-picking is a Tier 1
 * modifier and the worker has marked the day, so it decides the slot.
 */
async function makeBatch(page, project, dates, hours, pick) {
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  for (const d of dates) await tapDay(page, d);
  await page.getByRole("button", { name: "Fortsätt", exact: true }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: project });
  await page.getByLabel("Timmar på rad 1").fill(hours);
  if (pick) await page.getByRole("button", { name: pick, exact: true }).click();
  await page.getByRole("button", { name: /Skapa \d+ pass/ }).click();
  await mustSee(page, "Passen är skapade", `the batch for ${project} did not generate`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const ymd = (n) => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};
const ONGOING = ymd(-1);   // already started: cannot be deleted

/**
 * A run of four consecutive days for project A, overlapping two of them for B.
 *
 * ANCHORED TO A MONDAY, and that is the whole point. The continuity check below
 * measures that consecutive days touch, which they only do along a week row --
 * a run crossing Sunday into Monday wraps to the next row and reads as a
 * 375px gap. Starting at a fixed offset made this a test that passed or failed
 * by the day of the week it was run on, which is worse than no test.
 *
 * Searched forward rather than computed, so the month guard below is satisfied
 * by construction on every date it can be satisfied at all.
 */
const isMonday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 1;
const RUN_A = (() => {
  for (let n = 8; n <= 40; n++) {
    if (!isMonday(ymd(n))) continue;
    const run = [ymd(n), ymd(n + 1), ymd(n + 2), ymd(n + 3)];
    if (new Set([...run, ONGOING].map((d) => d.slice(0, 7))).size === 1) return run;
  }
  fail("no Monday-anchored run fits in one calendar month with yesterday; the calendar would need paging");
})();
const RUN_B = [RUN_A[2], RUN_A[3]];

/**
 * The day everything lands on.
 *
 * Five projects run here, which is one more than a cell draws. That is the
 * whole point: four stripes fit, so it takes a fifth to prove the cell stops
 * growing and starts counting instead.
 */
const BUSY = RUN_A[2];

console.log(`\nCalendar: A on ${RUN_A[0]}..${RUN_A.at(-1)}, B on ${RUN_B[0]}..${RUN_B.at(-1)}, five projects on ${BUSY}\n`);

try {
  // ---- setup ---------------------------------------------------------------
  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));
  const L = await createPerson(page, `Ledare K${RUN}`, `lk.${RUN}@bella.test`, "arbetsledare");
  const W = await createPerson(page, `Ada K${RUN}`, `adak.${RUN}@bella.test`, "arbetare");
  const A = `Alfa ${RUN}`, B = `Beta ${RUN}`;
  // Three more that run on the busy day only. A day cell draws four stripes,
  // so five projects is the smallest number that exercises the counter.
  const EXTRA = [`Ceta ${RUN}`, `Deta ${RUN}`, `Eta ${RUN}`];
  for (const name of [A, B, ...EXTRA]) {
    await createProject(page, name, `Ledare K${RUN}`, today);
  }
  log(`created five projects and one arbetsledare on all of them`);
  await signOut(page);

  // The worker marks every day, so the tiers put them on the shifts.
  await signIn(page, W.email, W.password);
  await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
  for (const d of [...new Set([...RUN_A, ONGOING])]) await tapDay(page, d);
  await signOut(page);

  await signIn(page, L.email, L.password);
  await makeBatch(page, A, RUN_A, "8", W.name);
  await makeBatch(page, B, RUN_B, "6");
  for (const name of EXTRA) await makeBatch(page, name, [BUSY], "5");
  await makeBatch(page, A, [ONGOING], "8");
  log(`generated a four-day run on Alfa, a two-day run on Beta, three more on ${BUSY}, and one past day`);

  // ---- the calendar --------------------------------------------------------
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
  await mustSee(page, A, "the calendar does not show Alfa");
  await mustSee(page, B, "the calendar does not show Beta");

  /**
   * Every cell, measured. The count comes from the cell's own aria-label, so
   * the arithmetic below is checked against what the page itself claims is on
   * the day rather than against a number this script assumed.
   */
  const cells = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("[data-date]")) {
      const r = el.getBoundingClientRect();
      out.push({
        date: el.getAttribute("data-date"),
        height: Math.round(r.height),
        projects: Number(/,\s*(\d+)\s+projekt/.exec(el.getAttribute("aria-label") ?? "")?.[1] ?? -1),
        stripes: [...el.querySelectorAll("span[style]")]
          .map((s) => getComputedStyle(s).backgroundColor)
          .filter((c) => c && c !== "rgba(0, 0, 0, 0)"),
        overflow: Number(/\+(\d+)/.exec(el.innerText)?.[1] ?? 0),
        text: el.innerText,
      });
    }
    return out;
  });

  if (cells.some((c) => c.projects < 0)) fail("a day cell does not declare how many projects are on it");

  /**
   * Project name -> the colour of its stripe, sampled across the whole grid.
   *
   * The title attribute is the only place the grid still holds a name, and it
   * is what lets the day page's tabs be checked against the calendar below.
   * Collected from every cell, not just the busy one, so a project pushed
   * behind a "+N" there is still sampled from a quieter day.
   */
  const calendarColours = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-date] span[title]")]
        .map((s) => [s.getAttribute("title"), getComputedStyle(s).backgroundColor]),
    ),
  );

  /**
   * THE FAILURE THIS REPLACED. A cell used to reserve a line for every project
   * in the month, so a busy month grew cells taller than the screen. Heights
   * are compared across the WHOLE grid -- an empty Sunday against a day with
   * five sites on it -- because equal-among-the-busy-ones would still pass on
   * a layout that grows.
   */
  const heights = [...new Set(cells.map((c) => c.height))];
  if (heights.length !== 1) {
    const worst = cells.slice().sort((a, b) => b.height - a.height)[0];
    fail(
      `day cells are not all the same height (${heights.sort((a, b) => a - b).join(", ")}px). ` +
      `${worst.date} holds ${worst.projects} projects and is ${worst.height}px`,
    );
  }
  const busiest = cells.reduce((m, c) => (c.projects > m.projects ? c : m), cells[0]);
  if (busiest.projects < 5) {
    fail(`expected a day holding at least five projects, the busiest held ${busiest.projects}`);
  }
  log(`every day cell is ${heights[0]}px tall, and ${busiest.date} holds ${busiest.projects} projects`);

  // Four stripes fit; past that the rest are counted. Checked on every cell,
  // so an empty day, a full one and an overflowing one all have to agree.
  const MAX_STRIPES = 4;
  for (const c of cells) {
    const expected = c.projects <= MAX_STRIPES ? c.projects : MAX_STRIPES - 1;
    if (c.stripes.length !== expected) {
      fail(`${c.date}: ${c.projects} projects should draw ${expected} stripes, drew ${c.stripes.length}`);
    }
    if (c.overflow !== c.projects - expected) {
      fail(`${c.date}: ${c.projects} projects and ${expected} stripes should read "+${c.projects - expected}", read "+${c.overflow}"`);
    }
  }
  log(`stripes cap at ${MAX_STRIPES}; beyond that the remainder is counted, and the counts add up`);

  /**
   * No two stripes on the same day are the same colour.
   *
   * That is the whole claim the colour makes -- that this Tuesday is several
   * different sites. The palette is eight, indexed by position among the
   * projects with shifts THIS MONTH, so a collision means the month has
   * outgrown the palette rather than that the colouring is broken; hence the
   * count in the failure message.
   */
  const busyColours = cells.find((c) => c.date === BUSY)?.stripes ?? [];
  const distinct = new Set(cells.flatMap((c) => c.stripes)).size;
  if (busyColours.length < 2) fail(`no stripes to compare on ${BUSY}`);
  if (new Set(busyColours).size !== busyColours.length) {
    fail(`two projects on ${BUSY} share a colour; the month draws ${distinct} distinct colours, the palette holds 8`);
  }
  log(`projects on one day are told apart by colour (${busyColours.slice(0, 2).join(" / ")})`);

  // The grid is colour only. A name at 10px in a seventh of a phone is not a
  // name, it is noise -- the legend underneath is what names them.
  const gridText = cells.map((c) => c.text).join(" ");
  for (const name of [A, B, ...EXTRA]) {
    if (gridText.includes(name)) fail(`the grid writes "${name}" into a day cell; stripes carry colour only`);
  }
  const legend = await page.locator("main").innerText();
  for (const name of [A, B, ...EXTRA]) {
    if (!legend.includes(name)) fail(`the legend does not name "${name}"`);
  }
  log("no project names in the grid; every project named in the legend below it");
  await shot(page, "60-kalender");

  // ---- tapping a day -------------------------------------------------------
  // It LEAVES the page now. openDay waits on the URL, so reaching the next
  // line is itself the assertion that the navigation happened.
  await openDay(page, BUSY);
  log(`tapping ${BUSY} navigated to ${new URL(page.url()).pathname}${new URL(page.url()).search}`);

  // Every project working the day has a tab, even the three that were behind
  // the "+N" on the calendar and had no stripe of their own.
  for (const name of [A, B, ...EXTRA]) {
    if (!(await page.locator(`[data-project-tab="${name}"]`).count())) {
      fail(`the day page has no tab for "${name}"`);
    }
  }
  log(`all ${2 + EXTRA.length} projects on the day have a tab, including those counted as "+N"`);

  /**
   * The tab wears the colour the calendar gave the project.
   *
   * This is what makes the stripe a person pressed and the tab they land on
   * the same site. It is also the one thing that broke silently while the
   * colour index was computed from whatever projects happened to be on screen:
   * both screens looked right on their own and disagreed with each other.
   */
  const tabColour = async (name) =>
    page.locator(`[data-tab-swatch="${name}"]`).first()
      .evaluate((s) => getComputedStyle(s).backgroundColor);
  for (const name of [A, B]) {
    const stripe = calendarColours[name];
    if (!stripe) fail(`no calendar stripe was sampled for "${name}"`);
    const tab = await tabColour(name);
    if (!tab || tab === "rgba(0, 0, 0, 0)") {
      fail(`the day page drew no colour on the tab for "${name}" (the calendar drew ${stripe})`);
    }
    if (tab !== stripe) {
      fail(`"${name}" is ${stripe} on the calendar and ${tab} on the day page`);
    }
  }
  log("each project's tab carries the same colour it wears on the calendar");

  /**
   * ONE PROJECT AT A TIME.
   *
   * Read off the pass cards' own headings rather than the panel's text: every
   * project's name is on screen regardless, on its tab. The heading is the
   * only place that says whose shift is actually being shown -- and getByText
   * matching substrings is exactly how a check like this comes out green while
   * showing the wrong thing.
   */
  const shownProjects = () =>
    page.locator("[data-day-panel] section > p:nth-child(1)").allInnerTexts();

  await chooseProject(page, B);
  let shown = await shownProjects();
  if (shown.length !== 1 || shown[0] !== B) {
    fail(`choosing Beta should show its one pass and nothing else; showed [${shown.join(", ")}]`);
  }
  await chooseProject(page, A);
  shown = await shownProjects();
  if (shown.length !== 1 || shown[0] !== A) {
    fail(`choosing Alfa should show its one pass and nothing else; showed [${shown.join(", ")}]`);
  }
  log("the day shows one project at a time, and the tabs move between them");
  await shot(page, "61-kalender-dag-oppen");

  // A leader cannot delete -- checked with Alfa's pass card on screen.
  await mustSee(page, "07:00", "Alfa's shift did not render");
  if (await page.getByRole("button", { name: /Ta bort detta pass/ }).count()) {
    fail("an arbetsledare was offered pass deletion");
  }
  log("no delete control for the arbetsledare");
  await signOut(page);

  // ---- an arbetare is turned away -------------------------------------------
  await signIn(page, W.email, W.password);
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
  await mustSee(page, "visar hela företagets schema", "an arbetare was shown the shift calendar");
  await mustNotSee(page, A, "an arbetare could see the company's projects");
  log("an arbetare is told the calendar is not theirs");
  await signOut(page);

  // ---- the admin deletes ----------------------------------------------------
  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));

  /**
   * Scoped to THIS run's project, not .first().
   *
   * The day shows one project at a time now, but a tab still has to be chosen
   * before the button exists at all -- and this database keeps what every
   * previous run created, on these same dates, because the dates come from the
   * calendar and not from the run. .first() once deleted whichever Alfa sorted
   * first, the notification went to a worker from a run three passes ago, and
   * the assertion at the end failed while every screen it named had worked.
   */
  const deleteButton = (project) =>
    // `> p`, a DIRECT child: the day panel wraps these, so a descendant match
    // resolves to two nested elements and the locator never settles.
    page.locator(`section:has(> p:text-is("${project}"))`)
        .getByRole("button", { name: /Ta bort detta pass/ });

  // An ongoing pass cannot be deleted -- it is a fact to be confirmed.
  await openDay(page, ONGOING);
  await chooseProject(page, A);
  await deleteButton(A).waitFor({ timeout: 20000 });
  await deleteButton(A).click();
  await mustSee(page, "Passet har redan börjat", "a started pass was deleted");
  await shot(page, "62-kalender-paborjat");
  log("a pass that has started cannot be deleted");

  // A future one can. Back out to the calendar and in through another day,
  // which is also the trip a person makes.
  await openDay(page, RUN_A[0]);
  await chooseProject(page, A);
  await deleteButton(A).click();
  await mustSee(page, "Passet är borttaget", "the future pass was not deleted");
  await shot(page, "63-kalender-borttaget");
  log("the admin deleted a future pass");
  await signOut(page);

  // ---- the worker is told ---------------------------------------------------
  // On the LANDING page: the notice used to live on Mina pass, and moved to
  // the badge under the stamp when the arbetare landing page was built. One
  // home for it, so dismissing it once dismisses it.
  await signIn(page, W.email, W.password);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await mustSee(page, `Ditt pass ${RUN_A[0]} är borttaget`, "the worker was not notified");
  await shot(page, "64-arbetare-notis");
  log("the worker is told their pass was removed");

  await page.getByRole("button", { name: "Okej" }).first().click();
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "networkidle" });
  await mustNotSee(page, `Ditt pass ${RUN_A[0]} är borttaget`, "the notice came back after dismissal");
  log("dismissing the notice keeps it dismissed");

  console.log("\nSHIFT CALENDAR WALKTHROUGH COMPLETE.\n");
} finally {
  await browser.close();
}
