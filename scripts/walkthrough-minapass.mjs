#!/usr/bin/env node
/**
 * Mina Pass, both views.
 *
 *   Lista    -- grouped by day, future first, past above it
 *   Kalender -- days worked filled, two projects told apart by FILL and not by
 *               colour, tapping a day opening that day's shifts
 *
 * The hours line is the part worth testing hardest, because invariant 10 lives
 * on it: a figure appears only once an Arbetsdagbok covering the day has been
 * generated, and until then the worker is told which of the two silences
 * applies rather than shown a blank.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/Shift-Setter";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });

const ADMIN = {
  email: required("WALKTHROUGH_ADMIN_EMAIL"),
  password: required("WALKTHROUGH_ADMIN_PASSWORD"),
};
const RUN = Date.now().toString().slice(-6);

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };
const shot = (page, n) => page.screenshot({ path: path.join(ART, `${n}.png`), fullPage: true });

const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

async function mustSee(page, text, why) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 20000 });
  } catch {
    await shot(page, "FAILED");
    fail(`${why} (never saw "${text}"; see artifacts/FAILED.png)`);
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
  const password = /Lösenord:\s*(\S+)/.exec(await page.locator("pre").first().innerText())?.[1];
  if (!password) fail(`no password for ${name}`);
  await page.getByRole("button", { name: "Tillverka arbetare" }).click();
  await page.getByText("Klar", { exact: false }).first().waitFor({ timeout: 20000 });
  return { email, password, name };
}

async function createProject(page, name, leader, start) {
  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  await field(page, "Projektnamn").fill(name);
  await field(page, "Projektets adress").fill(`${name}vägen 1, 242 30 Hörby`);
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Bygg");
  await field(page, "Startdatum").fill(start);
  await field(page, "Arbetsledare").selectOption({ label: leader });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
}

async function reachDay(page, date) {
  for (let i = 0; i < 18; i++) {
    if (await page.locator(`[data-date="${date}"]`).count()) return;
    await page.getByRole("button", { name: "Nästa månad", exact: true }).click();
    await page.waitForTimeout(400);
  }
  fail(`could not page the calendar to ${date}`);
}

/** Read before tapping: the calendar gesture is a toggle. */
async function markDay(page, date) {
  const marked = () => page.locator(`[data-date="${date}"][aria-label*="kan jobba"]`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
    await reachDay(page, date);
    await page.waitForTimeout(800);
    if (await marked().count()) return;
    await page.getByRole("button", { name: "Kan jobba", exact: true }).click();
    const cell = page.locator(`[data-date="${date}"]`);
    await cell.scrollIntoViewIfNeeded();
    const b = await cell.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(2000);
  }
  fail(`could not mark ${date}`);
}

async function makePass(page, project, date, pick) {
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  await reachDay(page, date);
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.getByRole("button", { name: /Klar, / }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: project });
  await page.getByLabel("Timmar på rad 1").fill("8");
  await page.getByRole("button", { name: pick, exact: true }).click();
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "1 av 1 platser tillsatta", `${date} did not fill with ${pick}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

const sv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });
const day = (n) => sv.format(new Date(Date.now() + n * 864e5));

// One day gone (so it can be confirmed and filed), one still to come. Both
// inside this month, or the calendar view would need paging to show them.
const OLDER = day(-2);
const PAST = day(-1);
const FUTURE = day(3);

console.log(`\nMina Pass at ${BASE}\n`);

try {
  // ---- setup: two projects, so the calendar has two fills to tell apart ----
  await signIn(page, ADMIN.email, ADMIN.password);
  const L = await createPerson(page, `Mia Ledare ${RUN}`, `ml.${RUN}@bella.test`, "arbetsledare");
  const W = await createPerson(page, `Moa ${RUN}`, `mw.${RUN}@bella.test`, "arbetare");
  const P1 = `Alfa ${RUN}`, P2 = `Beta ${RUN}`;
  await createProject(page, P1, L.name, PAST);
  await createProject(page, P2, L.name, PAST);
  await signOut(page);

  await signIn(page, W.email, W.password);
  await markDay(page, OLDER);
  await markDay(page, PAST);
  await markDay(page, FUTURE);
  await signOut(page);

  await signIn(page, L.email, L.password);
  await makePass(page, P1, OLDER, W.name);
  await makePass(page, P1, PAST, W.name);
  await makePass(page, P2, FUTURE, W.name);
  log(`${W.name} works ${P1} on ${OLDER} and ${PAST}, ${P2} on ${FUTURE}`);

  // The past day is confirmed but NOT yet filed: that is the state invariant
  // 10 exists for.
  // Both gone days, oldest first -- the queue hands them over one at a time.
  await page.goto(`${BASE}/bekrafta/`, { waitUntil: "networkidle" });
  await mustSee(page, W.name, "the past days did not reach the confirmation queue");
  for (let i = 0; i < 3; i++) {
    if (await page.getByText("Inget att bekräfta").count()) break;
    await field(page, "Timmar").fill("8");
    await field(page, "Vad vi gjorde").fill("La stenmjöl och packade.");
    await page.getByRole("button", { name: "Bekräfta dagen" }).click();
    await page.waitForTimeout(2500);
  }
  await page.getByText("Inget att bekräfta").waitFor({ timeout: 20000 });
  await signOut(page);
  log("both gone days are confirmed, and no Arbetsdagbok covers them yet");

  // ---- LISTA ---------------------------------------------------------------
  await signIn(page, W.email, W.password);
  await page.goto(`${BASE}/mina-pass/`, { waitUntil: "networkidle" });

  const toggle = page.getByRole("group", { name: "Visa som" });
  await toggle.waitFor({ timeout: 20000 });
  const lista = toggle.getByRole("button", { name: "Lista", exact: true });
  const kalender = toggle.getByRole("button", { name: "Kalender", exact: true });
  if ((await lista.getAttribute("aria-pressed")) !== "true") {
    fail("Lista is not the default view");
  }
  log("the toggle offers Lista and Kalender, and Lista is the default");

  for (const p of [P1, P2]) {
    await mustSee(page, p, `the list does not show ${p}`);
  }
  await mustSee(page, "07:00–16:00", "the list shows no times");
  await mustSee(page, `${P1}vägen 1`, "the list shows no address");
  log("grouped by day, each entry naming the project, its address and the times");

  // Invariant 10, both silences, on one screen.
  await mustSee(page, "Väntar på arbetsdagbok",
    "a confirmed but unfiled day must say it is waiting");
  await mustSee(page, "Inte bekräftat än",
    "a day that has not happened yet must say so rather than show a figure");
  if (await page.getByText("8 h", { exact: true }).count()) {
    await shot(page, "FAILED");
    fail("hours were shown before an Arbetsdagbok covered the day");
  }
  await shot(page, "m1-lista");
  log("no hours anywhere: the gone days wait for the document, the coming one is not confirmed");

  // Future first, past above it. The page opens scrolled past what has
  // already happened rather than at the top of the record.
  const scrolled = await page.evaluate(() => window.scrollY);
  const heights = await page.evaluate(() => [
    document.documentElement.scrollHeight, window.innerHeight,
  ]);
  if (heights[0] <= heights[1]) {
    fail(`the page does not scroll (${heights[0]}px in ${heights[1]}px), so this proves nothing`);
  }
  if (scrolled <= 0) fail("the list opened at the top, showing the past first");

  log(`the list opens scrolled ${Math.round(scrolled)}px down, with the past above it`);

  // ---- KALENDER ------------------------------------------------------------
  await kalender.click();
  await page.waitForTimeout(600);

  const worked = page.locator(`[data-date="${PAST}"]`);
  await worked.waitFor({ timeout: 20000 });

  // Filled by pattern, not by colour: assert the computed background carries
  // no hue at all -- every rgb triple in it must be a grey.
  const bg = await worked.evaluate((el) => getComputedStyle(el).background);
  const hues = [...bg.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)]
    .filter(([, r, g, b]) => !(r === g && g === b));
  if (hues.length > 0) fail(`the calendar uses colour: ${hues[0][0]} in ${bg}`);
  if (!/gradient|rgb\(0, 0, 0\)/.test(bg)) {
    fail(`a worked day has no fill at all: ${bg}`);
  }
  log("worked days are filled, and every fill is a grey or a black-and-white pattern");

  // Two projects, two different fills.
  const other = page.locator(`[data-date="${FUTURE}"]`);
  const bg2 = await other.evaluate((el) => getComputedStyle(el).background);
  if (bg === bg2) fail("two different projects share a fill");
  log("two projects, two fills -- told apart without colour");

  for (const p of [P1, P2]) {
    if (!(await page.getByText(p, { exact: false }).count())) {
      fail(`the legend does not name ${p}`);
    }
  }
  log("the legend names both projects");

  // Tapping a day opens it.
  await worked.click();
  await page.waitForTimeout(600);
  await mustSee(page, P1, "tapping a worked day did not open that day");
  await mustSee(page, "Väntar på arbetsdagbok",
    "the day panel must apply invariant 10 exactly as the list does");
  await shot(page, "m2-kalender");
  log("tapping a day opens that day's shift, with the same hours rule as the list");

  console.log("\nMINA PASS COMPLETE.\n");
} finally {
  await browser.close();
}
