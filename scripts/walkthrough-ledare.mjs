#!/usr/bin/env node
/**
 * Drive the arbetsledare's landing page.
 *
 *   the hero count of days owed · Skapa pass · the Nästa Pass card with a
 *   Leaflet map, the shift's span, no hours figure, and a link into the
 *   phone's own navigation · a menu of exactly three things.
 *
 * THE COUNT IS THE PART WORTH TESTING HARDEST. The handoff replaced the
 * day-by-day preview and the red dot with one number, so that number is now
 * the only thing on the screen saying work is outstanding: it has to be the
 * right number, and the action under it has to open the day it is counting.
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
  const password = (await page.locator("[data-password]").first().innerText()).trim();
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
  await page.getByRole("button", { name: "Fortsätt", exact: true }).click();
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
  await markDay(page, soon);
  await signOut(page);

  await signIn(page, L.email, L.password);
  // THE LEADER IS NOT HAND-PICKED ONTO EITHER DAY. Handplock is arbetare only,
  // and a leader does not queue for their own project -- STEP 4b places them on
  // any day their project has workers on it. So both passes go to the worker,
  // and the leader's own next shift on the coming day is the row the auto-assignment
  // makes, carrying the envelope across that day rather than one pass's times.
  await makePass(page, project, yesterday, W.name, "8");
  await makePass(page, project, soon, W.name, "7");
  log(`a day gone unconfirmed (${yesterday}) and the leader auto-placed on ${soon}`);

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

  // "Skapa pass", sentence case, which is how the handoff writes every label.
  const skapa = page.getByRole("link", { name: "Skapa pass", exact: true });
  if (!(await skapa.count())) fail("no Skapa pass button");
  const sbox = await skapa.boundingBox();
  if (Math.round(sbox.height) !== 60) fail(`Skapa pass is ${sbox.height}px tall, wanted 60`);
  const sbg = await skapa.evaluate((el) => getComputedStyle(el).backgroundColor);
  if (sbg !== "rgb(238, 243, 254)") fail(`Skapa pass is ${sbg}, wanted the #eef3fe panel`);
  log(`Skapa pass: 60px on ${sbg}, the second-rank action`);

  // ---- the hero: the count of days owed ------------------------------------
  //
  // ONE NUMBER, AND IT HAS TO BE RIGHT. The handoff's Startsida drops the
  // day-by-day preview and the red dot in favour of a single count, so this is
  // the only thing on the screen that says anything is outstanding. This
  // fixture leaves exactly one day unconfirmed, and Swedish counts one day in
  // the singular -- "1 dag", not "1 dagar".
  const hero = page.getByRole("status");
  await hero.waitFor({ timeout: 20000 });
  for (let i = 0; i < 40 && (await hero.innerText()).trim() === "…"; i++) {
    await page.waitForTimeout(250);
  }
  const count = (await hero.innerText()).trim();
  if (count !== "1 dag") {
    await shot(page, "FAILED");
    fail(`the hero counts ${JSON.stringify(count)}, and exactly one day is waiting`);
  }
  await mustSee(page, "Väntar på dig", "the hero has no kicker saying whose the days are");
  await mustSee(page, "Bekräfta den innan admin kan godkänna.",
                "the hero does not say why the days matter");
  log(`hero reads "Väntar på dig / ${count}" -- no preview list, no red dot`);

  // The dot is GONE, not merely restyled. #d62728 is not in this design's
  // palette; a leftover would be the one thing on the screen in a colour the
  // system does not have.
  const reds = await page.locator("body").evaluate(() =>
    [...document.querySelectorAll("*")]
      .map((el) => getComputedStyle(el).backgroundColor)
      .filter((c) => c === "rgb(214, 39, 40)").length);
  if (reds > 0) fail(`${reds} element(s) still painted #d62728, which is not in the palette`);
  log("nothing on the page is painted the old notification red");

  // 66px on the accent, with its own shadow: the one primary action.
  const cta = page.getByRole("link", { name: "Bekräfta pass", exact: true });
  const box = await cta.boundingBox();
  if (Math.round(box.height) !== 66) fail(`the primary action is ${box.height}px tall, wanted 66`);
  const cbg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
  if (cbg !== "rgb(27, 44, 193)") fail(`the primary action is ${cbg}, wanted the accent #1b2cc1`);
  log(`primary action 66px on ${cbg}`);

  await shot(page, "l1b-hero");
  await cta.click();
  await page.waitForURL((u) => u.pathname.includes("/bekrafta"), { timeout: 20000 });
  await mustSee(page, W.name, "the hero's action opened a page about a different day");
  const dayHeading = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", weekday: "long" })
    .format(new Date(`${yesterday}T12:00:00Z`)).toUpperCase();
  if (!(await page.locator("main, [data-soft-screen]").first().innerText()).toUpperCase().includes(dayHeading)) {
    fail(`Bekräfta Pass did not open on ${yesterday}, which is the day the count is counting`);
  }
  log("tapping it opens Bekräfta Pass, on the day the count was counting");

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await landed(page);

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

  // THE SPAN, AND THE FIGURE THAT MUST NOT BE THERE.
  //
  // 07:00-16:00 is /pass/ny's default and makePass leaves it alone, so this
  // is the span read back off the card -- for the leader, the envelope on
  // their auto-assigned row.
  //
  // No hours figure, and that is the assertion with teeth. INVARIANT 10
  // masks a day's hours until an Arbetsdagbok covers the date, which a
  // coming day never has -- and on an auto-assigned leader row the pass's
  // planned_hours is not the leader's figure at all. Copying the Acceptera
  // Pass card's "07:00-16:00 · 8 h" wholesale is the mistake this catches.
  if (!text.includes("07:00\u201316:00")) {
    fail(`the Nästa Pass card shows no time span: ${JSON.stringify(text)}`);
  }
  const figure = text.match(/\d+(?:[,.]\d+)?\s*h\b/);
  if (figure) {
    fail(`the Nästa Pass card prints an hours figure (${figure[0]}); invariant 10 masks it`);
  }
  log("span 07:00\u201316:00, and no hours figure on a day nothing has been filed for");

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
  const expect = ["Arbetsdagar", "Mina Pass", "Bekräftelser"].sort();
  if (JSON.stringify(got) !== JSON.stringify(expect)) {
    fail(`menu holds ${JSON.stringify(got)}, expected ${JSON.stringify(expect)}`);
  }
  await shot(page, "l3-meny");
  log(`menu holds exactly ${expect.join(", ")}`);

  console.log("\nARBETSLEDARE LANDING PAGE COMPLETE.\n");
} finally {
  await browser.close();
}
