#!/usr/bin/env node
/**
 * Nästa Pass leaves when the SHIFT ends, not when the day does.
 *
 * Two shifts: one today 07:00-12:00, one tomorrow 07:00-16:00. The browser's
 * clock is faked at 10:00 today, so the first is under way and is what the card
 * shows. Time is then wound past 12:00 WITHOUT RELOADING, and the card has to
 * swap to tomorrow's on its own.
 *
 * The no-reload part is the whole point. The bug was that a finished shift sat
 * on the home screen until midnight; a fix that only corrected the query would
 * still leave it there until something re-rendered, which for somebody standing
 * on site holding their phone is the same bug.
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

const sv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });
const day = (n) => sv.format(new Date(Date.now() + n * 864e5));
const TODAY = day(0), TOMORROW = day(1);

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
  await page.getByLabel("Timmar på rad 1").fill("5");
  await page.getByRole("button", { name: pick, exact: true }).click();
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "1 av 1 platser tillsatta", `${date} did not fill with ${pick}`);
}

/**
 * Everything the Nästa Pass card currently says, once it says anything.
 *
 * runFor is not padding. With a faked clock, timers only move when told to --
 * and React's scheduler is timer-based, so a page that has fetched its rows
 * will still sit on "Laddar…" until the clock is allowed to tick. Reading
 * before that is reading a frame the app never meant to show.
 */
async function cardText(page, until) {
  const card = page.locator("h2:text-is('Nästa Pass')").locator("xpath=..");
  await card.waitFor({ timeout: 20000 });
  for (let i = 0; i < 40; i++) {
    const text = await card.innerText();
    if (!text.includes("Laddar…") && (!until || text.includes(until))) return text;
    // Ticks the page's clock, not the wall. waitForTimeout would spin forever:
    // real seconds do not reach a faked timer, and the render that follows the
    // timer firing is itself scheduled on one.
    await page.clock.runFor(250);
  }
  return card.innerText();
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

console.log(`\nNästa Pass at ${BASE}\n`);

try {
  // ---- setup: one shift today, one tomorrow ------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  const L = await createPerson(page, `Nils Ledare ${RUN}`, `nl.${RUN}@bella.test`, "arbetsledare");
  const W = await createPerson(page, `Nora ${RUN}`, `nw.${RUN}@bella.test`, "arbetare");

  const IDAG = `Idagjobbet ${RUN}`, IMORGON = `Imorgonjobbet ${RUN}`;
  for (const [name, start] of [[IDAG, TODAY], [IMORGON, TOMORROW]]) {
    await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
    await field(page, "Projektnamn").fill(name);
    await field(page, "Projektets adress").fill("Storgatan 1, 242 30 Hörby");
    await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
    await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
    await field(page, "Beställarens org nummer").fill("556123-4567");
    await field(page, "Tjänster").fill("Bygg");
    await field(page, "Startdatum").fill(start);
    await field(page, "Arbetsledare").selectOption({ label: L.name });
    await page.getByRole("button", { name: "Skapa projekt" }).click();
    await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  }
  await signOut(page);

  await signIn(page, W.email, W.password);
  await markDays(page, [TODAY, TOMORROW]);
  await signOut(page);

  await signIn(page, L.email, L.password);
  await makePass(page, IDAG, TODAY, W.name, "07:00", "12:00");
  await makePass(page, IMORGON, TOMORROW, W.name, "07:00", "16:00");
  await signOut(page);
  log(`${W.name} works ${IDAG} 07:00-12:00 today and ${IMORGON} 07:00-16:00 tomorrow`);

  // ---- 10:00 today: the shift under way is the card ----------------------
  //
  // The clock is installed BEFORE the app loads, so every Date the page makes
  // comes from it -- including the one the card arms its timer against.
  const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00`);
  await page.clock.install({ time: at("10:00") });

  await signIn(page, W.email, W.password);
  let card = await cardText(page, IDAG);
  if (!card.includes(IDAG)) {
    await shot(page, "FAILED");
    fail(`at 10:00 the card should show today's shift: ${JSON.stringify(card)}`);
  }
  if (!card.includes("07:00–12:00")) {
    fail(`the card should show the span it is counting down: ${JSON.stringify(card)}`);
  }
  await shot(page, "np1-under-passet");
  log("at 10:00 the card shows the shift under way -- ending is the test, not starting");

  // ---- past 12:00, with no reload ----------------------------------------
  // "02:05:00", not "02:05": Playwright reads a two-part string as mm:ss, so
  // the short form winds the clock two MINUTES and the shift never ends.
  await page.clock.fastForward("02:05:00");
  card = await cardText(page, IMORGON);
  if (card.includes(IDAG)) {
    await shot(page, "FAILED");
    fail(`after 12:00 today's finished shift is still on the card: ${JSON.stringify(card)}`);
  }
  if (!card.includes(IMORGON)) {
    await shot(page, "FAILED");
    fail(`tomorrow's shift should have taken its place: ${JSON.stringify(card)}`);
  }
  await shot(page, "np2-efter-passet");
  log("at 12:05 it is gone and tomorrow's has taken its place -- no reload, no midnight");

  // ---- and it did not need the calendar day to turn ----------------------
  const stillToday = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  if (stillToday !== TODAY) {
    fail(`the clock rolled past midnight (${stillToday}); this proved the old behaviour`);
  }
  log(`the calendar day never changed -- still ${TODAY}, which is what the bug hid behind`);

  console.log("\nNÄSTA PASS COMPLETE.\n");
} finally {
  await browser.close();
}
