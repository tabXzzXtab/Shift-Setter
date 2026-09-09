#!/usr/bin/env node
/**
 * Stäng Pågående Pass -- ending a shift that is running, from Alla Pass.
 *
 * One pass covering right now with two people on it: one who clocked in and
 * one who never turned up. Closing has to tell them apart, because the
 * Arbetsdagbok reads released_at is null -- releasing both would erase the
 * hours the first one actually worked.
 *
 * The last assertion is the one that matters most: closing does NOT confirm
 * the day. The admin was not there, and stage 1 stays the arbetsledare's.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";
import { openDayPage } from "./day-page.mjs";

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
  const password = (await page.locator("[data-password]").first().innerText()).trim();
  if (!password) fail(`no password for ${name}`);
  await page.getByRole("button", { name: "Tillverka arbetare" }).click();
  await page.getByText("Klar", { exact: false }).first().waitFor({ timeout: 20000 });
  return { email, password, name };
}

const sv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });
const TODAY = sv.format(new Date());

async function reach(page, date) {
  for (let i = 0; i < 24; i++) {
    if (await page.locator(`[data-date="${date}"]`).count()) return;
    await page.getByRole("button", { name: "Nästa månad", exact: true }).click();
    await page.waitForTimeout(350);
  }
  fail(`could not page the calendar to ${date}`);
}

async function tap(page, date) {
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

/** Read before tapping: the calendar gesture is a toggle. */
async function markDay(page, date) {
  const marked = () => page.locator(`[data-date="${date}"][aria-label*="kan jobba"]`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
    await reach(page, date);
    await page.waitForTimeout(800);
    if (await marked().count()) return;
    await page.getByRole("button", { name: "Kan jobba", exact: true }).click();
    await tap(page, date);
    await page.waitForTimeout(2000);
  }
  fail(`could not mark ${date}`);
}

/** This run's pass card in Alla Pass, scoped to the project name. */
const passCard = (page, project) =>
  page.locator("div.border-2").filter({ hasText: project }).first();

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

console.log(`\nStäng Pågående Pass at ${BASE}\n`);

try {
  // ---- a pass running right now, with two slots -------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  const L = await createPerson(page, `Sten Ledare ${RUN}`, `sl.${RUN}@bella.test`, "arbetsledare");
  const A = await createPerson(page, `Anton ${RUN}`, `sa.${RUN}@bella.test`, "arbetare");
  const B = await createPerson(page, `Bodil ${RUN}`, `sb.${RUN}@bella.test`, "arbetare");

  const P = `Stangjobbet ${RUN}`;
  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  await field(page, "Projektnamn").fill(P);
  await field(page, "Projektets adress").fill("Storgatan 1, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Bygg");
  await field(page, "Startdatum").fill(TODAY);
  await field(page, "Arbetsledare").selectOption({ label: L.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  await signOut(page);

  for (const w of [A, B]) {
    await signIn(page, w.email, w.password);
    await markDay(page, TODAY);
    await signOut(page);
  }

  // 00:00-23:59 so it is under way whatever hour this run is started at.
  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  await reach(page, TODAY);
  await tap(page, TODAY);
  await page.getByRole("button", { name: "Fortsätt", exact: true }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: P });
  await field(page, "Börjar").fill("00:00");
  await field(page, "Slutar").fill("23:59");
  await page.getByLabel("Timmar på rad 1").fill("8");
  await page.getByLabel("Fler på rad 1").click();       // two slots
  await page.getByRole("button", { name: A.name, exact: true }).click();
  await page.getByRole("button", { name: B.name, exact: true }).click();
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "2 av 2 platser tillsatta", "the two-slot pass was not filled");
  log(`${A.name} and ${B.name} hold a pass running now on ${P}`);

  // ---- an arbetsledare is not offered it --------------------------------
  await page.goto(`${BASE}/pass/`, { waitUntil: "networkidle" });
  await mustSee(page, P, "the leader cannot see their own project's pass");
  if (await passCard(page, P).getByRole("button", { name: "Stäng Pass" }).count()) {
    await shot(page, "FAILED");
    fail("an arbetsledare is offered Stäng Pass; ending a day early is the admin's");
  }
  log("an arbetsledare is not offered Stäng Pass -- they run the day, they do not end it");
  await signOut(page);

  // ---- one clocks in, one never comes -----------------------------------
  await signIn(page, A.email, A.password);
  await page.getByRole("button", { name: /Stämpla In/ }).click();
  // THE BUTTON IS THE CONFIRMATION. The handoff's startsida carries a status
  // dot and no status text -- "Du är instämplad." is gone with the sentence it
  // was -- so what proves the stamp landed is that the one action on the
  // screen has flipped to its other state.
  try {
    await page.getByRole("button", { name: /Stämpla Ut/ }).waitFor({ timeout: 20000 });
  } catch {
    await shot(page, "FAILED");
    fail(`${A.name} could not clock in`);
  }
  await signOut(page);
  log(`${A.name} clocked in; ${B.name} never did`);

  // ---- the admin closes it ----------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`${BASE}/pass/`, { waitUntil: "networkidle" });
  await mustSee(page, "Pågår nu", "the running pass is not marked as running");

  const btn = passCard(page, P).getByRole("button", { name: "Stäng Pass" });
  await btn.waitFor({ timeout: 20000 });
  await btn.click();

  const prompt = page.getByRole("dialog", { name: "Stäng pass" });
  await prompt.waitFor({ timeout: 20000 });
  await mustSee(page, "Vill du logga tiden detta passet har jobbat?",
    "the closing prompt does not ask the question");
  await shot(page, "sp1-fragan");
  log("Stäng Pass asks whether to log the time the pass has worked");

  const hours = prompt.getByLabel("Timmar passet har jobbat");
  const prefilled = await hours.inputValue();
  if (!prefilled) fail("the hours field is not prefilled from what has elapsed");
  await hours.fill("3,5");
  await prompt.getByRole("button", { name: "Stäng passet" }).click();
  await mustSee(page, "Passet är stängt", "closing did not report");
  await shot(page, "sp2-stangt");
  log(`the figure is prefilled from the elapsed time (${prefilled}) and stays editable`);

  // ---- and it is no longer running --------------------------------------
  await page.goto(`${BASE}/pass/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  if (await passCard(page, P).getByRole("button", { name: "Stäng Pass" }).count()) {
    await shot(page, "FAILED");
    fail("the pass is still offered Stäng Pass after being closed");
  }
  log("the pass has ended -- it is no longer running, so it can no longer be closed");

  // ---- who is left on the day -------------------------------------------
  // Named to the project: the day page shows one at a time, and this database
  // has a dozen other runs' shifts on today. Without it the text handed back
  // would belong to whichever site sorts first.
  await openDayPage(page, BASE, TODAY, P);
  const day = await page.locator("main").innerText();
  if (!day.includes(A.name)) {
    await shot(page, "FAILED");
    fail(`${A.name} clocked in and must still be on the day: ${JSON.stringify(day.slice(0, 400))}`);
  }
  if (day.includes(B.name)) {
    await shot(page, "FAILED");
    fail(`${B.name} never clocked in and should have been released`);
  }
  await shot(page, "sp3-dagen");
  log(`${A.name} keeps the day and the hours; ${B.name} is off it -- nothing to account for`);

  await signOut(page);

  // ---- stage 1 is untouched ----------------------------------------------
  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/bekrafta/`, { waitUntil: "networkidle" });
  await mustSee(page, P, "the day left the leader's queue; closing must not confirm it");
  await shot(page, "sp4-bekrafta");
  log("the day is still the arbetsledare's to confirm -- closing is not a stage 1 claim");

  console.log("\nSTÄNG PASS COMPLETE.\n");
} finally {
  await browser.close();
}
