#!/usr/bin/env node
/**
 * Avboka Pass on a worker -- Step 5b, in a browser.
 *
 * Three shifts, because the rule has two axes: is anyone free, and is the
 * shift inside five days.
 *
 *   far  + someone free  -> Välj Utbyte, and picking a name fills the slot
 *   far  + nobody free   -> no popup, the slot goes out as Acceptera Pass
 *   near + someone free  -> Välj Utbyte STILL, because choosing is manual
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

/**
 * Page the calendar forward until the day is on screen.
 *
 * Every calendar here shows one month. The "nobody is free" day has to be one
 * nobody has ever marked, which on a database this old means months out, and
 * a cell that is not rendered is not a cell you can tap.
 */
async function reachDay(page, date) {
  for (let i = 0; i < 18; i++) {
    if (await page.locator(`[data-date="${date}"]`).count()) return;
    await page.getByRole("button", { name: "Nästa månad", exact: true }).click();
    await page.waitForTimeout(400);
  }
  fail(`could not page the calendar to ${date}`);
}

/** Read before tapping: the calendar gesture is a toggle. */
async function markDays(page, dates) {
  for (const date of dates) {
    const marked = () => page.locator(`[data-date="${date}"][aria-label*="kan jobba"]`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
      await reachDay(page, date);
      await page.waitForTimeout(800);
      if (await marked().count()) break;
      await page.getByRole("button", { name: "Kan jobba", exact: true }).click();
      const cell = page.locator(`[data-date="${date}"]`);
      await cell.scrollIntoViewIfNeeded();
      const b = await cell.boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(2000);
      if (attempt === 3 && !(await marked().count())) fail(`could not mark ${date}`);
    }
  }
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

/** Open the day in the shift calendar and press the bin beside a name. */
async function avboka(page, date, name) {
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
  await reachDay(page, date);
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  const bin = page.getByRole("button", { name: `Ta bort ${name}`, exact: true });
  await bin.waitFor({ timeout: 20000 });
  await bin.click();
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
const FAR = day(10), NEAR = day(2);

/**
 * The "nobody is free" day has to be a day NOBODY has ever marked, and the
 * candidate list is company-wide. A fixed offset is not that: this script's
 * own previous run left an Alva who marked it and was then taken off it, so
 * she was free and the popup fired where the test wanted silence. Spread per
 * run, far past every other walkthrough's dates.
 */
const NONE = day(120 + (Number(RUN) % 240));

console.log(`\nAvboka Pass at ${BASE}\n`);

try {
  // ---- setup ---------------------------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  const L = await createPerson(page, `Lena Ledare ${RUN}`, `vl.${RUN}@bella.test`, "arbetsledare");
  const A = await createPerson(page, `Alva ${RUN}`, `va.${RUN}@bella.test`, "arbetare");
  const B = await createPerson(page, `Bengt ${RUN}`, `vb.${RUN}@bella.test`, "arbetare");

  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const project = `Utbyte ${RUN}`;
  await field(page, "Projektnamn").fill(project);
  await field(page, "Projektets adress").fill("Storgatan 1, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Bygg");
  await field(page, "Startdatum").fill(NEAR);
  await field(page, "Arbetsledare").selectOption({ label: L.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  await signOut(page);

  // Alva works all three days. Bengt is free on two of them and has not marked
  // the third, which is what makes the third have nobody to ask.
  await signIn(page, A.email, A.password);
  await markDays(page, [FAR, NONE, NEAR]);
  await signOut(page);

  await signIn(page, B.email, B.password);
  await markDays(page, [FAR, NEAR]);
  await signOut(page);

  await signIn(page, L.email, L.password);
  for (const d of [FAR, NONE, NEAR]) await makePass(page, project, d, A.name);
  log(`three shifts on ${FAR}, ${NONE} and ${NEAR}, all held by ${A.name}`);

  // ---- far, and someone is free -------------------------------------------
  await avboka(page, FAR, A.name);
  const popup = page.getByRole("dialog", { name: "Välj Utbyte" });
  await popup.waitFor({ timeout: 20000 });
  if (!(await popup.getByRole("button", { name: B.name, exact: true }).count())) {
    await shot(page, "FAILED");
    fail(`Välj Utbyte does not list ${B.name}`);
  }
  if (await popup.getByRole("button", { name: A.name, exact: true }).count()) {
    fail("the person just taken off is offered as their own replacement");
  }
  await shot(page, "v1-valj-utbyte");
  log(`Välj Utbyte lists ${B.name}, and not the person just removed`);

  await popup.getByRole("button", { name: B.name, exact: true }).click();
  await mustSee(page, `${B.name} tog ${A.name}s plats`, "picking a name did not fill the slot");
  await mustSee(page, "1 av 1 platser", "the slot did not come back to full");
  await shot(page, "v2-utbytt");
  log(`${B.name} took the place; the shift is full again and headcount never dropped`);

  // ---- far, and nobody is free --------------------------------------------
  await avboka(page, NONE, A.name);
  await mustSee(page, "Ingen förvald var ledig",
    "with nobody free there should be no popup, only the cards");
  await mustSee(page, "Acceptera Pass", "the slot did not go out as Acceptera Pass");
  if (await page.getByRole("dialog", { name: "Välj Utbyte" }).count()) {
    fail("a popup opened with nobody to put in it");
  }
  await shot(page, "v3-inga-lediga");
  log("nobody free: no popup, and the slot went out as Acceptera Pass");

  // ---- inside five days, and someone is free ------------------------------
  await avboka(page, NEAR, A.name);
  const near = page.getByRole("dialog", { name: "Välj Utbyte" });
  await near.waitFor({ timeout: 20000 });
  if (!(await near.getByRole("button", { name: B.name, exact: true }).count())) {
    fail(`inside five days Välj Utbyte should still list ${B.name}`);
  }
  await shot(page, "v4-inom-fem-dagar");
  log("inside five days the popup still fires -- choosing a name is manual placement");

  await near.getByRole("button", { name: "Ingen av dem", exact: true }).click();
  await page.waitForTimeout(1500);
  await mustSee(page, "0 av 1 platser", "declining the popup should leave the slot open");
  log("closing it without picking leaves the slot open, and sends nothing out");

  console.log("\nAVBOKA PASS (WORKER) COMPLETE.\n");
} finally {
  await browser.close();
}
