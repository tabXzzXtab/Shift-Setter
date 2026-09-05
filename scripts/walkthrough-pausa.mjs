#!/usr/bin/env node
/**
 * Pausa kontot -- what a pause takes and what it leaves, in a browser.
 *
 * Three days on one project:
 *
 *   today      a shift that has ALREADY STARTED   -- a pause must not touch it
 *   today+20   a future shift held by that worker -- released
 *   today+21   a future shift under the leader    -- for the leader half
 *
 * Two halves, because the two triggers are different pieces. app.tg_account_pause
 * gives up what has not started; app.tg_account_unpause puts a paused
 * arbetsledare back on the days their people are still working. Nothing puts a
 * paused ARBETARE back -- a released slot was offered to somebody else the
 * moment it opened, and taking it off them would be a second person's day
 * cancelled to undo the first.
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

async function reach(page, date) {
  for (let i = 0; i < 24; i++) {
    if (await page.locator(`[data-date="${date}"]`).count()) return;
    const next = page.getByRole("button", { name: "Nästa månad", exact: true });
    const prev = page.getByRole("button", { name: "Föregående månad", exact: true });
    await (date > new Date().toISOString().slice(0, 10) ? next : prev).click();
    await page.waitForTimeout(400);
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
async function markDays(page, dates) {
  for (const date of dates) {
    const marked = () => page.locator(`[data-date="${date}"][aria-label*="kan jobba"]`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
      await reach(page, date);
      await page.waitForTimeout(800);
      if (await marked().count()) break;
      await page.getByRole("button", { name: "Kan jobba", exact: true }).click();
      await tap(page, date);
      await page.waitForTimeout(2000);
      if (attempt === 3 && !(await marked().count())) fail(`could not mark ${date}`);
    }
  }
}

async function makePass(page, project, date, pick, start, end) {
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  await reach(page, date);
  await tap(page, date);
  await page.getByRole("button", { name: /Klar, / }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: project });
  await field(page, "Börjar").fill(start);
  await field(page, "Slutar").fill(end);
  await page.getByLabel("Timmar på rad 1").fill("8");
  await page.getByRole("button", { name: pick, exact: true }).click();
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "1 av 1 platser tillsatta", `${date} did not fill with ${pick}`);
}

/** Open a day in the shift calendar and hand back everything it says. */
async function dayText(page, date) {
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
  await reach(page, date);
  await tap(page, date);
  await page.getByText("platser", { exact: false }).first().waitFor({ timeout: 20000 });
  return page.locator("main").innerText();
}

/** Pausa kontot / Aktivera kontot, on the named person's card. */
async function setActive(page, name, active) {
  await page.goto(`${BASE}/installningar/`, { waitUntil: "networkidle" });
  const card = page.locator("section").filter({ hasText: name });
  await card.first().waitFor({ timeout: 20000 });
  await card.first().getByRole("button", { name: active ? "Aktivera kontot" : "Pausa kontot" }).click();
  await page.waitForTimeout(2500);
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
const TODAY = day(0), FUTURE = day(20), LEADERDAY = day(21);

console.log(`\nPausa kontot at ${BASE}\n`);

try {
  // ---- setup ---------------------------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  const L = await createPerson(page, `Pia Ledare ${RUN}`, `pl.${RUN}@bella.test`, "arbetsledare");
  const W = await createPerson(page, `Pontus ${RUN}`, `pw.${RUN}@bella.test`, "arbetare");
  const W2 = await createPerson(page, `Petra ${RUN}`, `p2.${RUN}@bella.test`, "arbetare");

  const P = `Paus ${RUN}`;
  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  await field(page, "Projektnamn").fill(P);
  await field(page, "Projektets adress").fill("Pausgatan 1, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Bygg");
  await field(page, "Startdatum").fill(TODAY);
  await field(page, "Arbetsledare").selectOption({ label: L.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  await signOut(page);

  await signIn(page, W.email, W.password);
  await markDays(page, [TODAY, FUTURE]);
  await signOut(page);

  await signIn(page, W2.email, W2.password);
  await markDays(page, [LEADERDAY]);
  await signOut(page);

  await signIn(page, L.email, L.password);
  // 00:00-23:59 so the day is UNDER WAY right now: started, not finished.
  await makePass(page, P, TODAY, W.name, "00:00", "23:59");
  await makePass(page, P, FUTURE, W.name, "07:00", "16:00");
  await makePass(page, P, LEADERDAY, W2.name, "07:00", "16:00");
  await signOut(page);
  log(`${W.name} is mid-shift today and booked on ${FUTURE}; ${L.name} leads all three days`);

  // ---- the pause -----------------------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  await setActive(page, W.name, false);
  await mustSee(page, "Kontot är pausat", "pausing said nothing");
  await mustSee(page, "pågående pass är deras sista",
    "the notice does not say the running shift is kept");
  await shot(page, "pa1-pausad");
  log(`${W.name} paused, and the screen states what that took and what it left`);

  const card = await page.locator("section").filter({ hasText: W.name }).first().innerText();
  if (!card.includes("Pausad")) fail(`the card should read Pausad: ${JSON.stringify(card)}`);

  // FUTURE: released. The slot is open again and their name is gone.
  const future = await dayText(page, FUTURE);
  if (future.includes(W.name)) {
    await shot(page, "FAILED");
    fail(`${W.name} still holds ${FUTURE}; a pause releases what has not started`);
  }
  if (!future.includes("0 av 1 platser")) {
    fail(`${FUTURE} should be open again: ${JSON.stringify(future)}`);
  }
  await shot(page, "pa2-framtiden-slappt");
  log(`the future shift on ${FUTURE} is released and the slot is open again`);

  // TODAY: untouched. They are standing on it.
  const today = await dayText(page, TODAY);
  if (!today.includes(W.name)) {
    await shot(page, "FAILED");
    fail(`${W.name} lost today's shift; it had already started and is hours they worked`);
  }
  await shot(page, "pa3-idag-orord");
  log("the shift already running is untouched -- those are hours they actually worked");

  // ---- unpausing an arbetare gives nothing back ----------------------------
  await setActive(page, W.name, true);
  await mustSee(page, "Kontot är aktivt igen", "unpausing said nothing");
  const back = await dayText(page, FUTURE);
  if (back.includes(W.name)) {
    await shot(page, "FAILED");
    fail(`${W.name} was put back on ${FUTURE}; an arbetare's released slot is somebody else's now`);
  }
  log("unpausing an arbetare restores nothing -- the slot was offered on the day it opened");

  // ---- the leader half -----------------------------------------------------
  const led = await dayText(page, LEADERDAY);
  if (!led.includes(L.name)) fail(`${L.name} should be on ${LEADERDAY} to begin with`);

  await setActive(page, L.name, false);
  const gone = await dayText(page, LEADERDAY);
  if (gone.includes(L.name)) {
    await shot(page, "FAILED");
    fail(`${L.name} is still on ${LEADERDAY} after being paused`);
  }
  await shot(page, "pa4-ledare-av");
  log(`a paused arbetsledare comes off ${LEADERDAY} -- ${W2.name} is still on it, with nobody over them`);

  await setActive(page, L.name, true);
  const rehired = await dayText(page, LEADERDAY);
  if (!rehired.includes(L.name)) {
    await shot(page, "FAILED");
    fail(`${L.name} was not put back on ${LEADERDAY}; unpausing must re-place a leader`);
  }
  await shot(page, "pa5-ledare-tillbaka");
  log("unpausing puts the arbetsledare back on the day their people are still working");

  console.log("\nPAUSA KONTOT COMPLETE.\n");
} finally {
  await browser.close();
}
