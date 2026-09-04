#!/usr/bin/env node
/**
 * The shift calendar in a browser.
 *
 * What it proves:
 *   - two projects on one calendar, each its own colour, sampled from the page
 *   - a run of consecutive days is ONE continuous bar: the segments touch, with
 *     no gap between them, and the name is written once at the run's start
 *   - tapping a day opens everything that day, across both projects
 *   - an arbetsledare sees only their own project; an arbetare is turned away
 *   - only the admin can delete a pass
 *   - an ongoing pass cannot be deleted
 *   - deleting a future one notifies the worker, and it leaves their list
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

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
  await page.getByRole("button", { name: "Logga ut" }).click();
  await page.waitForURL(/login/, { timeout: 20000 });
}
async function createPerson(page, name, email, role) {
  await page.goto(`${BASE}/arbetare/ny/`, { waitUntil: "networkidle" });
  await field(page, "Namn").fill(name);
  await field(page, "E-post").fill(email);
  await field(page, "Roll").selectOption(role);
  await page.getByRole("button", { name: /Kopiera inloggning/ }).click();
  const password = /Lösenord:\s*(\S+)/.exec(await page.locator("pre").first().innerText())?.[1];
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
  await page.getByRole("button", { name: /Klar, / }).click();
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

console.log(`\nCalendar: A on ${RUN_A[0]}..${RUN_A.at(-1)}, B on ${RUN_B[0]}..${RUN_B.at(-1)}\n`);

try {
  // ---- setup ---------------------------------------------------------------
  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));
  const L = await createPerson(page, `Ledare K${RUN}`, `lk.${RUN}@bella.test`, "arbetsledare");
  const W = await createPerson(page, `Ada K${RUN}`, `adak.${RUN}@bella.test`, "arbetare");
  const A = `Alfa ${RUN}`, B = `Beta ${RUN}`;
  await createProject(page, A, `Ledare K${RUN}`, today);
  await createProject(page, B, `Ledare K${RUN}`, today);
  log(`created two projects and one arbetsledare on both`);
  await signOut(page);

  // The worker marks every day, so the tiers put them on the shifts.
  await signIn(page, W.email, W.password);
  await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
  for (const d of [...new Set([...RUN_A, ONGOING])]) await tapDay(page, d);
  await signOut(page);

  await signIn(page, L.email, L.password);
  await makeBatch(page, A, RUN_A, "8", W.name);
  await makeBatch(page, B, RUN_B, "6");
  await makeBatch(page, A, [ONGOING], "8");
  log("generated a four-day run on Alfa, a two-day run on Beta, and one past day");

  // ---- the calendar --------------------------------------------------------
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
  await mustSee(page, A, "the calendar does not show Alfa");
  await mustSee(page, B, "the calendar does not show Beta");

  // Each project a colour, and two projects never the same one.
  const colours = await page.evaluate((dates) => {
    const out = {};
    for (const d of dates) {
      const cell = document.querySelector(`[data-date="${d}"]`);
      out[d] = [...cell.querySelectorAll("span[style]")]
        .map((s) => getComputedStyle(s).backgroundColor)
        .filter((c) => c && c !== "rgba(0, 0, 0, 0)");
    }
    return out;
  }, RUN_A);

  const alfa = colours[RUN_A[0]]?.[0];
  const both = colours[RUN_A[2]] ?? [];
  if (!alfa) fail("no coloured bar on Alfa's first day");
  if (both.length !== 2) fail(`expected two project bars on ${RUN_A[2]}, saw ${both.length}`);
  if (both[0] === both[1]) fail("the two projects share a colour");
  log(`each project has its own colour (${both.join(" / ")})`);

  // A run of consecutive days is one continuous bar: the segments touch.
  const geom = await page.evaluate((dates) => {
    const rects = dates.map((d) => {
      const cell = document.querySelector(`[data-date="${d}"]`);
      const bar = [...cell.querySelectorAll("span[style]")][0];
      return bar ? bar.getBoundingClientRect() : null;
    });
    return rects.map((r) => (r ? { x: r.x, right: r.right, y: r.y, h: r.height } : null));
  }, RUN_A.slice(0, 3));   // Monday-anchored, so these three share a week row

  for (let i = 1; i < geom.length; i++) {
    const prev = geom[i - 1], cur = geom[i];
    if (!prev || !cur) fail(`missing bar on day ${i} of the run`);
    if (Math.abs(cur.x - prev.right) > 1.5) {
      fail(`the run is broken: day ${i} starts ${(cur.x - prev.right).toFixed(1)}px after the previous ends`);
    }
    if (Math.abs(cur.y - prev.y) > 0.5) fail(`the run jumps rows: day ${i} sits at a different height`);
  }
  log("consecutive days form one continuous bar -- segments touch, same line");

  // The name is written once, at the start of the run.
  const labels = await page.evaluate(({ dates, name }) => dates.map((d) => {
    const cell = document.querySelector(`[data-date="${d}"]`);
    return cell.innerText.includes(name);
  }), { dates: RUN_A, name: A });
  if (!labels[0]) fail("the run's first day does not carry the project name");
  // Repeats only where the run wraps onto a new week row; a mid-week day never
  // carries it, or the bar becomes a wall of text.
  const midWeekRepeats = RUN_A.slice(1).filter((d, i) => {
    const monday = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7 === 0;
    return labels[i + 1] && !monday;
  });
  if (midWeekRepeats.length) fail(`the project name repeats mid-run on ${midWeekRepeats.join(", ")}`);
  log("the project name appears at the run's start, and again only on a week wrap");
  await shot(page, "60-kalender");

  // ---- tapping a day -------------------------------------------------------
  await tapDay(page, RUN_A[2]);
  await mustSee(page, "07:00", "tapping a day did not open it");
  // The panel wrapper, not the last pass card inside it -- `section` matches
  // every pass, and the last one naturally holds a single project.
  const dayText = await page.locator("[data-day-panel]").innerText();
  if (!dayText.includes(A) || !dayText.includes(B)) {
    fail("the opened day does not show every project working it");
  }
  await shot(page, "61-kalender-dag-oppen");
  log("tapping a day opens everything that day, across both projects");

  // A leader cannot delete.
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
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });

  /**
   * Scoped to THIS run's project, not .first().
   *
   * The day panel shows every project working that day, and this database
   * keeps what every previous run of this walkthrough created -- on these same
   * dates, because the dates come from the calendar and not from the run. So
   * .first() deleted whichever Alfa happened to sort first, the notification
   * went to a worker from a run three passes ago, and the assertion at the end
   * failed while every screen it named had worked.
   */
  const deleteButton = (project) =>
    // `> p`, a DIRECT child: the day panel is itself a <section> wrapping these,
    // so a descendant match resolves to two nested elements and the locator
    // never settles.
    page.locator(`section:has(> p:text-is("${project}"))`)
        .getByRole("button", { name: /Ta bort detta pass/ });

  // An ongoing pass cannot be deleted -- it is a fact to be confirmed.
  await tapDay(page, ONGOING);
  await deleteButton(A).waitFor({ timeout: 20000 });
  await deleteButton(A).click();
  await mustSee(page, "Passet har redan börjat", "a started pass was deleted");
  await shot(page, "62-kalender-paborjat");
  log("a pass that has started cannot be deleted");

  // A future one can.
  await tapDay(page, ONGOING);           // close it
  await tapDay(page, RUN_A[0]);
  await deleteButton(A).click();
  await mustSee(page, "Passet är borttaget", "the future pass was not deleted");
  await shot(page, "63-kalender-borttaget");
  log("the admin deleted a future pass");
  await signOut(page);

  // ---- the worker is told, and it is gone from their list -------------------
  await signIn(page, W.email, W.password);
  await page.goto(`${BASE}/mina-pass/`, { waitUntil: "networkidle" });
  await mustSee(page, `Ditt pass ${RUN_A[0]} är borttaget`, "the worker was not notified");
  await shot(page, "64-arbetare-notis");
  log("the worker is told their pass was removed");

  await page.getByRole("button", { name: "Okej" }).first().click();
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "networkidle" });
  await mustNotSee(page, `Ditt pass ${RUN_A[0]} är borttaget`, "the notice came back after dismissal");
  log("dismissing the notice keeps it dismissed");

  console.log("\nSHIFT CALENDAR WALKTHROUGH COMPLETE.\n");
} finally {
  await browser.close();
}
