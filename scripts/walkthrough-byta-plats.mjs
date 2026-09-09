#!/usr/bin/env node
/**
 * Byta Plats Med Arbetsledare -- two leaders trade the same day, in a browser.
 *
 * Two projects with different hours on one day, one leader each, placed
 * automatically by Step 4b. The admin opens the day and swaps them.
 *
 * The hours are the part worth watching: the envelope belongs to the project
 * and the people on it, so after the swap each leader holds the OTHER
 * project's span. The two are set eight hours apart so a swap that moved the
 * person and not the hours would be visible.
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

async function createProject(page, name, leader, start) {
  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  await field(page, "Projektnamn").fill(name);
  await field(page, "Projektets adress").fill(`${name}gatan 1, 242 30 Hörby`);
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
    await page.getByRole("button", { name: "Föregående månad", exact: true }).click();
    await page.waitForTimeout(400);
  }
  fail(`could not page the calendar back to ${date}`);
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

/** A one-slot pass, with times chosen so the two projects differ. */
async function makePass(page, project, date, pick, start, end) {
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  await reachDay(page, date);
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.getByRole("button", { name: "Fortsätt", exact: true }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: project });
  await field(page, "Börjar").fill(start);
  await field(page, "Slutar").fill(end);
  await page.getByLabel("Timmar på rad 1").fill("8");
  await page.getByRole("button", { name: pick, exact: true }).click();
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "1 av 1 platser tillsatta", `${date} did not fill with ${pick}`);
}

/** Open the day, on the named project's tab. */
async function openDay(page, date, project) {
  await openDayPage(page, BASE, date, project);
  await page.getByText("Arbetsledare", { exact: false }).first().waitFor({ timeout: 20000 });
}

/**
 * Read something off the day once per project, and hand back both answers.
 *
 * This suite is about two arbetsledare on two projects on one date, and the
 * day page shows ONE project at a time -- so "what the day says" is no longer
 * a single innerText. It is what each tab says, and the comparison this
 * walkthrough exists to make spans both of them.
 */
async function acrossProjects(page, date, projects, read) {
  const out = [];
  for (const p of projects) {
    await openDay(page, date, p);
    out.push(await read());
  }
  return out;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

const sv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });
const DAY = sv.format(new Date(Date.now() - 864e5));

console.log(`\nByta Plats Med Arbetsledare at ${BASE}\n`);

try {
  // ---- setup: two projects, two leaders, one day, different hours ---------
  await signIn(page, ADMIN.email, ADMIN.password);
  const L1 = await createPerson(page, `Ledare Ett ${RUN}`, `s1.${RUN}@bella.test`, "arbetsledare");
  const L2 = await createPerson(page, `Ledare Tva ${RUN}`, `s2.${RUN}@bella.test`, "arbetsledare");
  const W1 = await createPerson(page, `Wilma ${RUN}`, `sw.${RUN}@bella.test`, "arbetare");
  const W2 = await createPerson(page, `Wiktor ${RUN}`, `sv.${RUN}@bella.test`, "arbetare");
  const P1 = `Sodra ${RUN}`, P2 = `Norra ${RUN}`;
  await createProject(page, P1, L1.name, DAY);
  await createProject(page, P2, L2.name, DAY);
  await signOut(page);

  for (const w of [W1, W2]) {
    await signIn(page, w.email, w.password);
    await markDay(page, DAY);
    await signOut(page);
  }

  await signIn(page, L1.email, L1.password);
  await makePass(page, P1, DAY, W1.name, "07:00", "16:00");
  await signOut(page);

  await signIn(page, L2.email, L2.password);
  await makePass(page, P2, DAY, W2.name, "06:00", "14:00");
  await signOut(page);
  log(`${P1} runs 07:00–16:00 and ${P2} runs 06:00–14:00 on ${DAY}, a leader on each`);

  // ---- an arbetsledare is not offered the swap ----------------------------
  await signIn(page, L1.email, L1.password);
  // On every tab they can reach, not just the first: the offer being absent
  // from one project is not the offer being absent.
  const offered = await acrossProjects(page, DAY, [P1, P2], () =>
    page.getByRole("button", { name: /Byta Plats Med Arbetsledare/ }).count());
  if (offered.some((n) => n > 0)) {
    await shot(page, "FAILED");
    fail("an arbetsledare is offered the swap; it moves somebody else's day too");
  }
  log("an arbetsledare is not offered the swap -- it moves somebody else's day");
  await signOut(page);

  // ---- the admin swaps them ----------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);

  const before = (await acrossProjects(page, DAY, [P1, P2], () =>
    page.locator("main").innerText())).join("\n");
  if (!(before.includes("07:00–16:00") && before.includes("06:00–14:00"))) {
    await shot(page, "FAILED");
    fail(`the day should show both spans before the swap: ${JSON.stringify(before)}`);
  }
  // Back to P1, whose leader the swap is pressed on.
  await openDay(page, DAY, P1);
  await shot(page, "bp1-innan");
  log("the day shows both arbetsledare, each on their own project's hours");

  const btn = page.getByRole("button", { name: `Byta Plats Med Arbetsledare — ${L1.name}`, exact: true });
  await btn.waitFor({ timeout: 20000 });
  await btn.click();

  const popup = page.getByRole("dialog", { name: "Byta plats med arbetsledare" });
  await popup.waitFor({ timeout: 20000 });
  await mustSee(page, `Vem ska ${L1.name} byta plats med?`, "the popup does not ask the question");

  const partner = popup.getByRole("button", { name: new RegExp(L2.name) });
  if (!(await partner.count())) {
    await shot(page, "FAILED");
    fail(`${L2.name} has a day to trade and should be offered`);
  }
  const partnerText = await partner.first().innerText();
  if (!partnerText.includes("06:00–14:00")) {
    fail(`the partner should show the hours being handed over: ${JSON.stringify(partnerText)}`);
  }
  await shot(page, "bp2-popup");
  log(`popup offers ${L2.name} with the hours they are handing over`);

  await partner.first().click();
  await mustSee(page, "har bytt plats", "the swap did not report");
  await page.waitForTimeout(2000);
  log("the two swapped");

  // ---- the hours went with the project ------------------------------------
  // Both tabs: after the swap each leader is on the OTHER project, so the two
  // rows being compared are on two different tabs by definition.
  // Not just "an li mentioning them": the Avboka and Byta Plats buttons carry
  // the name too. The row is the one that states the role and the hours.
  const rows = (await acrossProjects(page, DAY, [P1, P2], () =>
    page.locator("li").allInnerTexts())).flat();
  // Uppercased, because allInnerTexts returns rendered text and the role label
  // is text-transform: uppercase.
  const row = (name) => rows.find(
    (t) => t.includes(name) && t.includes("ARBETSLEDARE") && !t.includes("Pass —"));
  const l1row = row(L1.name);
  const l2row = row(L2.name);
  if (!l1row || !l2row) {
    await shot(page, "FAILED");
    fail(`both arbetsledare should still be on the day: ${JSON.stringify(rows)}`);
  }
  // L1 came from 07:00-16:00 and now holds the other project's 06:00-14:00.
  if (!l1row.includes("06:00–14:00")) {
    fail(`${L1.name} should now hold the other project's span: ${JSON.stringify(l1row)}`);
  }
  if (!l2row.includes("07:00–16:00")) {
    fail(`${L2.name} should now hold the other project's span: ${JSON.stringify(l2row)}`);
  }
  await shot(page, "bp3-efter");
  log("each leader now holds the other project's hours -- the envelope followed the project");

  await signOut(page);

  // ---- whose day it is now, and whose it is not --------------------------
  //
  // Invariant 4b is scoped to the day, so this is the swap's real consequence:
  // the leader who swapped IN holds the project they went to, and it is in
  // their Bekrafta Pass. The leader who swapped OUT no longer holds the one
  // they left. Membership did not move; the day did.
  //
  // It doubles as the flag check. pending-days drops a flagged day out of
  // every leader's queue permanently, so a day sitting in one was not flagged.
  // /granska/ cannot answer that here -- it shows one day at a time, flagged
  // first, and a flagged day left by another walkthrough on this shared
  // database would stand in front of it either way.
  for (const [who, wentTo, cameFrom, tag] of [
    [L1, P2, P1, "ett"],
    [L2, P1, P2, "tva"],
  ]) {
    await signIn(page, who.email, who.password);
    await page.goto(`${BASE}/bekrafta/`, { waitUntil: "networkidle" });
    await mustSee(page, wentTo, `${who.name} should be confirming ${wentTo} now`);
    const queue = await page.locator("main").innerText();
    if (queue.includes(cameFrom)) {
      await shot(page, "FAILED");
      fail(`${who.name} can still confirm ${cameFrom}, a day they swapped out of`);
    }
    await shot(page, `bp4-bekrafta-${tag}`);
    await signOut(page);
  }
  log("each leader confirms the day they went to, and no longer the one they left");

  console.log("\nBYTA PLATS COMPLETE.\n");
} finally {
  await browser.close();
}
