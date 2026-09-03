#!/usr/bin/env node
/**
 * Generate a real month in a browser, edit one instance, and run the cascade.
 *
 * EVERY calendar gesture here is a genuine TOUCH event stream dispatched
 * through CDP -- touchStart / touchMove / touchEnd -- not page.mouse. They are
 * different code paths: a mouse-only test passes happily while a phone marks
 * the first cell and nothing else, because touch fires no enter/leave on the
 * elements a finger slides across.
 *
 * What it proves, in order:
 *   - a touch drag paints a run of days on the worker's förval calendar
 *   - a touch tap toggles a single day, and dragging back over it clears it
 *   - two template rows across twelve days generates twenty-four passes
 *   - editing one of those twenty-four leaves its siblings alone
 *   - removing a worker reopens the slot and cascades, beyond five days
 *   - inside five days it does not
 *
 * Coverage is a property of every worker in the database, not just the ones
 * this script creates, so the shortfall step asks for one more slot per day
 * than there are workers on the roster. That makes the flag fire whatever else
 * is in the database, rather than depending on a clean one.
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
    await shot(page, "FAILED-batch");
    const seen = await page.locator("main, body").first().innerText().catch(() => "(nothing)");
    fail(`${why} (never saw "${text}")
--- screen ---
${seen.slice(0, 900)}`);
  }
}
async function mustNotSee(page, text, why) {
  await page.waitForTimeout(1000);
  if (await page.getByText(text, { exact: false }).count()) {
    await shot(page, "FAILED-batch"); fail(`${why} (saw "${text}")`);
  }
}

// ---- genuine touch input ----------------------------------------------------
async function centres(page, dates) {
  const out = [];
  for (const d of dates) {
    const cell = page.locator(`[data-date="${d}"]`);
    await cell.waitFor({ timeout: 20000 });
    await cell.scrollIntoViewIfNeeded();
    const b = await cell.boundingBox();
    out.push({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }
  return out;
}

/** A finger pressed down, dragged across each day in turn, and lifted. */
async function touchDrag(page, dates) {
  const pts = await centres(page, dates);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ x: pts[0].x, y: pts[0].y }],
  });
  for (const p of pts.slice(1)) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: p.x, y: p.y }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(900);
}

/** A single finger tap on one day. */
async function touchTap(page, date) {
  const [p] = await centres(page, [date]);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(900);
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
  return { email, password };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"],          // hasTouch, isMobile -- a phone, not a desktop
  locale: "sv-SE",
  timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

if (!ctx._options?.hasTouch && !devices["Pixel 7"].hasTouch) fail("context is not a touch device");

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const ymd = (n) => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};
const MONTH_DAYS = Array.from({ length: 12 }, (_, i) => ymd(7 + i));  // twelve days, all >5 out
const NEAR = ymd(2);                                                  // inside five days
const SPARE = ymd(25);
if (new Set([...MONTH_DAYS, NEAR, SPARE].map((d) => d.slice(0, 7))).size !== 1) {
  fail("this run straddles a month boundary; the calendar would need paging");
}

console.log(`\nBatch of ${MONTH_DAYS.length} days: ${MONTH_DAYS[0]} … ${MONTH_DAYS.at(-1)}\n`);

try {
  // ---- setup ---------------------------------------------------------------
  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));
  const L = await createPerson(page, `Ledare B${RUN}`, `lb.${RUN}@bella.test`, "arbetsledare");
  const W = [];
  for (const n of ["Ada", "Bo", "Cim", "Dan"]) {
    W.push(await createPerson(page, `${n} B${RUN}`, `${n.toLowerCase()}.${RUN}@bella.test`, "arbetare"));
  }
  log("created one arbetsledare and four arbetare");

  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const project = `Månadsbygget ${RUN}`;
  await field(page, "Projektnamn").fill(project);
  await field(page, "Projektets adress").fill("Bruksgatan 8, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Murning");
  await field(page, "Startdatum").fill(today);
  await field(page, "Arbetsledare").selectOption({ label: `Ledare B${RUN}` });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  log(`created project "${project}"`);
  await signOut(page);

  // ---- workers paint förval, with a finger ---------------------------------
  for (const [i, w] of W.entries()) {
    await signIn(page, w.email, w.password);
    await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });

    // One continuous drag across the whole run of days.
    await touchDrag(page, MONTH_DAYS);
    if (i === 0) {
      // ...plus a single tap, and a tap back over it to clear -- the gesture a
      // leader picking scattered days depends on.
      await touchTap(page, SPARE);
      await page.locator(`[data-date="${SPARE}"][aria-label*="kan jobba"]`).waitFor({ timeout: 10000 });
      await touchTap(page, SPARE);
      await page.locator(`[data-date="${SPARE}"][aria-label*="omarkerad"]`).waitFor({ timeout: 10000 });
    }
    if (i < 2) await touchDrag(page, [NEAR]);   // two of them free on the near day

    await page.reload({ waitUntil: "networkidle" });
    for (const d of [MONTH_DAYS[0], MONTH_DAYS[5], MONTH_DAYS.at(-1)]) {
      await page.locator(`[data-date="${d}"][aria-label*="kan jobba"]`)
        .waitFor({ timeout: 15000 })
        .catch(() => fail(`touch drag did not mark ${d} for ${w.email}`));
    }
    if (i === 0) await shot(page, "30-forval-touchdrag");
    await signOut(page);
  }
  log(`all four painted ${MONTH_DAYS.length} days by touch drag; tap-to-toggle verified`);

  // ---- the leader picks the month, with a finger ---------------------------
  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });

  await touchDrag(page, MONTH_DAYS);
  await mustSee(page, `${MONTH_DAYS.length} dag(ar) valda`, "the touch drag did not select the days");

  // Drag back over one and it drops out; drag over it again and it returns.
  await touchTap(page, MONTH_DAYS[3]);
  await mustSee(page, `${MONTH_DAYS.length - 1} dag(ar) valda`, "tapping a selected day did not unselect it");
  await touchTap(page, MONTH_DAYS[3]);
  await mustSee(page, `${MONTH_DAYS.length} dag(ar) valda`, "tapping it again did not reselect it");
  await shot(page, "31-valj-dagar");
  log(`selected ${MONTH_DAYS.length} days by touch; tapping toggles one day`);

  await page.getByRole("button", { name: /Klar, / }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });

  // ---- the hours prefill ----------------------------------------------------
  // (end - start) - 30 min, and it stops following the times once typed over.
  const h1 = page.getByLabel("Timmar på rad 1");
  if ((await h1.inputValue()) !== "8,5") {
    fail(`07:00-16:00 should prefill 8,5 h; got "${await h1.inputValue()}"`);
  }

  const row1 = page.locator("fieldset:has(legend:text-is('Pass per dag')) > div > div").first();
  await row1.locator('input[type="time"]').nth(1).fill("17:00");
  if ((await h1.inputValue()) !== "9,5") {
    fail(`moving the end to 17:00 should re-suggest 9,5 h; got "${await h1.inputValue()}"`);
  }

  // A night shift crosses midnight rather than going negative.
  await row1.locator('input[type="time"]').first().fill("22:00");
  await row1.locator('input[type="time"]').nth(1).fill("06:00");
  if ((await h1.inputValue()) !== "7,5") {
    fail(`22:00-06:00 should prefill 7,5 h; got "${await h1.inputValue()}"`);
  }

  // Typed by hand: from here the times must not touch it.
  await h1.fill("7");
  await row1.locator('input[type="time"]').first().fill("07:00");
  await row1.locator('input[type="time"]').nth(1).fill("16:00");
  if ((await h1.inputValue()) !== "7") {
    fail(`a typed figure must survive a time change; got "${await h1.inputValue()}"`);
  }
  await shot(page, "70-timmar-forifyllt");
  log("hours prefill as span minus 30 min, and stop following once typed over");

  // ---- two template rows ----------------------------------------------------
  await field(page, "Projekt").selectOption({ label: project });

  // The shortfall is only meaningful against a known roster.
  // Coverage can never exceed the roster, so asking for one more slot per day
  // than there are workers guarantees a shortfall whatever else is in the
  // database. Pinning it to an exact roster size was brittle: the stable demo
  // accounts are legitimately recreated by demo:reset and the count moved.
  const roster = await page.locator("fieldset:has(legend:text-is('Handplocka (0)')) button").count();
  if (roster < 1) fail("no workers on the roster at all");
  if (roster + 1 > 20) fail(`roster of ${roster} exceeds what the headcount stepper allows`);
  // One more slot per day than there are workers, so the shortfall is certain.
  const headcount1 = roster + 1;
  for (let i = 1; i < headcount1; i++) {
    await page.getByRole("button", { name: "Fler på rad 1" }).click();
  }
  await page.getByRole("button", { name: "+ Lägg till rad" }).click();
  await page.getByLabel("Timmar på rad 2").fill("7,5");
  const row2 = page.locator("fieldset:has(legend:text-is('Pass per dag')) > div > div").nth(1);
  await row2.locator('input[type="time"]').first().fill("14:00");
  await row2.locator('input[type="time"]').nth(1).fill("22:00");

  const expectedSlots = MONTH_DAYS.length * (headcount1 + 1);   // row 2 keeps 1
  await mustSee(page,
    `2 rad(er) × ${MONTH_DAYS.length} dag(ar) = ${MONTH_DAYS.length * 2} pass, ${expectedSlots} platser`,
    "the batch arithmetic is wrong");
  await mustSee(page, "saknar folk som markerat dagen", "the batch shortfall was not flagged");
  await shot(page, "32-mall-rader");
  log(`two template rows over ${MONTH_DAYS.length} days = ${MONTH_DAYS.length * 2} passes, ` +
      `${expectedSlots} slots; shortfall flagged`);

  await page.getByRole("button", { name: new RegExp(`Skapa ${MONTH_DAYS.length * 2} pass`) }).click();
  // The heading first: "24 pass" alone also matches the button that submitted
  // the form, so a failed generation would have read as a success.
  await mustSee(page, "Passen är skapade", "the batch did not generate");
  await mustSee(page, `${MONTH_DAYS.length * 2} pass`, "the batch did not generate the right number of passes");
  await shot(page, "33-genererat");
  log("generated 24 passes and filled them down the tiers");

  // ---- one instance edited, siblings untouched -----------------------------
  const D = MONTH_DAYS[2], NEXT = MONTH_DAYS[3];
  await page.goto(`${BASE}/dag/`, { waitUntil: "networkidle" });
  await field(page, "Datum").fill(D);
  await mustSee(page, "07:00–16:00", "the day view shows no 07:00 pass to edit");

  await page.getByRole("button", { name: "Ändra detta pass" }).first().click();
  await page.locator('input[type="time"]').first().fill("05:30");
  await page.getByLabel("Timmar", { exact: true }).fill("3,25");
  await page.getByRole("button", { name: "Spara" }).click();
  await mustSee(page, "Övriga pass är orörda", "the edit did not save");
  await mustSee(page, "05:30", "the edited instance did not change");
  await shot(page, "34-ett-pass-andrat");

  // the OTHER pass on the same day is untouched
  await mustSee(page, "14:00–22:00", "the second row on the same day was disturbed");
  log("edited one instance: 05:30 / 3,25 h");

  // the same row on the NEXT day is untouched
  await field(page, "Datum").fill(NEXT);
  await mustSee(page, "07:00–16:00", "the next day's instance is missing");
  await mustNotSee(page, "05:30", "the edit reached the next day's instance");
  await shot(page, "35-syskon-orort");
  log("the next day's instance still reads 07:00–16:00 — siblings untouched");

  // ---- the cascade ----------------------------------------------------------
  await field(page, "Datum").fill(MONTH_DAYS[6]);
  await page.getByRole("button", { name: /^Ta bort / }).first().waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /^Ta bort / }).first().click();
  await mustSee(page, "Platsen öppnades igen", "the vacated slot did not reopen and cascade");
  await shot(page, "36-kaskad");
  log("removed a worker more than five days out: the slot reopened and cascaded");

  // ---- and not inside five days --------------------------------------------
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await touchTap(page, NEAR);
  await page.getByRole("button", { name: /Klar, / }).click();
  await field(page, "Projekt").selectOption({ label: project });
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "Passen är skapade", "the near-day pass was not created");

  await page.goto(`${BASE}/dag/`, { waitUntil: "networkidle" });
  await field(page, "Datum").fill(NEAR);
  await page.getByRole("button", { name: /^Ta bort / }).first().waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /^Ta bort / }).first().click();
  await mustSee(page, "inom fem dagar", "the five-day cutoff did not hold");
  await shot(page, "37-inom-fem-dagar");
  log("inside five days: removed, and nothing filled it automatically");

  console.log("\nBATCH WALKTHROUGH COMPLETE -- all gestures were touch, not mouse.\n");
} finally {
  await browser.close();
}
