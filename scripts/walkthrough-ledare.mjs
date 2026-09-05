#!/usr/bin/env node
/**
 * Drive the arbetsledare's landing page.
 *
 *   + Skapa Pass · the Bekräfta Pass widget with its red dot · the Nästa Pass
 *   card with a Leaflet map and a link into the phone's own navigation ·
 *   a menu of exactly three things.
 *
 * The widget is the part worth testing hardest: it claims to preview the days
 * actually waiting, so the assertions check that the day it names is the day
 * the Bekräfta Pass page then opens on.
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

/** The landing page once the account has arrived -- networkidle is too early. */
const landed = (page) =>
  page.getByRole("button", { name: "Meny", exact: true }).waitFor({ timeout: 30000 });

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
  const out = page.getByRole("button", { name: "Logga ut" });
  if (!(await out.count())) {
    // The redesigned landing pages keep Logga ut inside the profile popup.
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
 * Mark one day can-work on the signed-in person's own calendar, and CHECK it.
 *
 * READ BEFORE TAPPING. The gesture is a toggle -- painting a day that is
 * already marked clears it -- so a blind retry loop alternates between setting
 * and clearing, and whether the day survives depends on which attempt happened
 * to be last. That is how a run ended with the calendar showing a marked day
 * and the database holding nothing.
 *
 * The wait after the tap is for the write, which happens in an effect after
 * the gesture settles rather than in the tap handler.
 */
async function markDay(page, date) {
  const marked = () => page.locator(`[data-date="${date}"][aria-label*="kan jobba"]`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
    await page.locator(`[data-date="${date}"]`).waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);          // the month's marks land after the fetch

    if (await marked().count()) return;

    await page.getByRole("button", { name: "Kan jobba", exact: true }).click();
    const cell = page.locator(`[data-date="${date}"]`);
    await cell.scrollIntoViewIfNeeded();
    const b = await cell.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(2000);
  }

  await shot(page, "FAILED");
  fail(`could not mark ${date} as a day they can work`);
}

/** Create a one-slot pass on one day, hand-picking the named person. */
async function makePass(page, project, date, pick, hours) {
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.waitFor({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.getByRole("button", { name: /Klar, / }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: project });
  await page.getByLabel("Timmar på rad 1").fill(hours);
  await page.getByRole("button", { name: pick, exact: true }).click();
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "1 av 1 platser tillsatta", `the pass on ${date} did not fill with ${pick}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

const sv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });
const yesterday = sv.format(new Date(Date.now() - 864e5));
const soon = sv.format(new Date(Date.now() + 3 * 864e5));

// A real address, because the pin is geocoded through Nominatim and an
// invented street would test the fallback rather than the map.
const ADDRESS = "Stortorget 1, 211 22 Malmö";

console.log(`\nArbetsledare landing page at ${BASE}\n`);

try {
  // ---- setup ---------------------------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  const L = await createPerson(page, `Leif Ledare ${RUN}`, `ll.${RUN}@bella.test`, "arbetsledare");
  const W = await createPerson(page, `Wilma Arbetare ${RUN}`, `wa.${RUN}@bella.test`, "arbetare");

  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const project = `Stortorget ${RUN}`;
  await field(page, "Projektnamn").fill(project);
  await field(page, "Projektets adress").fill(ADDRESS);
  await field(page, "Beställarens adress").fill("Fakturagatan 9, 111 22 Stockholm");
  await field(page, "Beställarens bolag").fill("Malmö Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Stenläggning");
  await field(page, "Startdatum").fill(yesterday);
  await field(page, "Arbetsledare").selectOption({ label: L.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  log(`created ${L.name}, ${W.name} and project "${project}" at ${ADDRESS}`);
  await signOut(page);

  await signIn(page, W.email, W.password);
  await markDay(page, yesterday);
  await signOut(page);

  await signIn(page, L.email, L.password);
  await markDay(page, soon);           // the leader is also a worker
  await makePass(page, project, yesterday, W.name, "8");
  await makePass(page, project, soon, L.name, "7");
  log(`a day gone unconfirmed (${yesterday}) and the leader's own next shift (${soon})`);

  // ---- the landing page ----------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await landed(page);
  await shot(page, "l1-landning");

  for (const label of ["Meny", "Profil"]) {
    if (!(await page.getByRole("button", { name: label, exact: true }).count())) {
      fail(`the top bar has no ${label} button`);
    }
  }
  log("top bar: hamburger left, profile icon right");

  const skapa = page.getByRole("link", { name: "Skapa Pass", exact: true });
  if (!(await skapa.count())) fail("no + Skapa Pass button");
  log("+ Skapa Pass is on the page");

  // ---- the Bekräfta Pass widget -------------------------------------------
  const widget = page.locator('a[href*="bekrafta"]').first();
  await widget.waitFor({ timeout: 20000 });
  await page.getByText("Ingen tilldelad", { exact: true }).count();   // settle
  const preview = await widget.innerText();

  if (!preview.includes(W.name)) {
    fail(`the widget does not name the worker waiting: ${JSON.stringify(preview)}`);
  }
  if (!/\b8 h\b/.test(preview)) fail(`the widget shows no hours: ${JSON.stringify(preview)}`);
  const heading = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", weekday: "long" })
    .format(new Date(`${yesterday}T12:00:00Z`)).toUpperCase();
  if (!preview.toUpperCase().includes(heading)) {
    fail(`the widget does not name the day: ${JSON.stringify(preview)}`);
  }
  log(`widget previews ${JSON.stringify(preview.split("\n").slice(1).join(" | "))}`);

  const dot = page.getByRole("status");
  if (!(await dot.count())) fail("no notification dot while a day is pending");
  const red = await dot.first().evaluate((el) => getComputedStyle(el).backgroundColor);
  if (!/^rgb\(214, 39, 40\)$/.test(red)) fail(`the dot is not red: ${red}`);
  log(`red dot present (${red})`);

  await widget.click();
  await page.waitForURL((u) => u.pathname.includes("/bekrafta"), { timeout: 20000 });
  await mustSee(page, W.name, "the widget opened a page about a different day");
  log("tapping the widget opens Bekräfta Pass, on the day it previewed");

  // ---- Nästa Pass ----------------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await landed(page);

  const card = page.locator('a[href^="https://maps.google.com/maps?q="]');
  await card.waitFor({ timeout: 20000 });
  const href = await card.getAttribute("href");
  const want = `https://maps.google.com/maps?q=${encodeURIComponent(ADDRESS)}`;
  if (href !== want) fail(`the card links to ${href}\n  expected ${want}`);
  log("the card opens native navigation on the project address");

  const text = await card.innerText();
  for (const bit of [project, ADDRESS]) {
    if (!text.includes(bit)) fail(`the Nästa Pass card is missing ${JSON.stringify(bit)}`);
  }
  log(`card reads ${JSON.stringify(text.replace(/\n+/g, " | "))}`);

  // Read only: no accept, no deny.
  for (const word of ["Acceptera", "Neka", "Bekräfta"]) {
    if (await card.getByRole("button", { name: new RegExp(word) }).count()) {
      fail(`the Nästa Pass card offers a "${word}" button; it is read only`);
    }
  }
  log("read only -- no accept, no deny");

  // The map. Geocoded through Nominatim, so give it room.
  try {
    await card.locator(".leaflet-container").waitFor({ timeout: 30000 });
  } catch {
    await shot(page, "FAILED");
    fail("no Leaflet map on the card (Nominatim may have refused the lookup)");
  }
  const tiles = await card.locator('img.leaflet-tile[src*="tile.openstreetmap.org"]').count();
  if (tiles === 0) fail("the map drew no OpenStreetMap tiles");
  if (!(await card.locator(".leaflet-control-attribution").count())) {
    fail("the map carries no OpenStreetMap attribution");
  }
  await shot(page, "l2-nasta-pass");
  log(`Leaflet map with ${tiles} OpenStreetMap tiles, attributed, pin on the project address`);

  // ---- the menu ------------------------------------------------------------
  await page.getByRole("button", { name: "Meny", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Meny" });
  await panel.waitFor({ timeout: 20000 });
  const items = await panel.getByRole("link").allInnerTexts();
  // Each entry carries a trailing arrow glyph; strip it to get the label.
  const got = items.map((t) => t.replace("→", "").trim()).sort();
  const expect = ["Min Pass Kalender", "Mina Pass", "Bekräftelse Historik"].sort();
  if (JSON.stringify(got) !== JSON.stringify(expect)) {
    fail(`menu holds ${JSON.stringify(got)}, expected ${JSON.stringify(expect)}`);
  }
  await shot(page, "l3-meny");
  log(`menu holds exactly ${expect.join(", ")}`);

  console.log("\nARBETSLEDARE LANDING PAGE COMPLETE.\n");
} finally {
  await browser.close();
}
