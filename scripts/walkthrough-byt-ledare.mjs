#!/usr/bin/env node
/**
 * Step 5c -- Avboka Pass on an arbetsledare, in a browser.
 *
 * Three past days on one project, one per route:
 *
 *   another arbetsledare takes it   -> the day carries on normally
 *   a worker covers as ansvarig     -> flagged, admin only
 *   nobody                          -> flagged harder, admin only
 *
 * The leader is on each day automatically (Step 4b), so the popup has
 * something real to take off.
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

async function reachDay(page, date) {
  for (let i = 0; i < 18; i++) {
    if (await page.locator(`[data-date="${date}"]`).count()) return;
    await page.getByRole("button", { name: "Föregående månad", exact: true }).click();
    await page.waitForTimeout(400);
  }
  fail(`could not page the calendar back to ${date}`);
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

/** Open the day in the shift calendar and press Avboka Pass on the leader. */
async function avbokaLeader(page, date, leaderName) {
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
  await reachDay(page, date);
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  const btn = page.getByRole("button", { name: `Avboka Pass — ${leaderName}`, exact: true });
  await btn.waitFor({ timeout: 20000 });
  await btn.click();
  const popup = page.getByRole("dialog", { name: "Byt arbetsledare" });
  await popup.waitFor({ timeout: 20000 });
  return popup;
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
const SWAP = day(-1), COVER = day(-2), NOBODY = day(-3);

console.log(`\nAvboka Pass on an arbetsledare at ${BASE}\n`);

try {
  // ---- setup ---------------------------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  const L1 = await createPerson(page, `Ledare Ett ${RUN}`, `b1.${RUN}@bella.test`, "arbetsledare");
  const L2 = await createPerson(page, `Ledare Tva ${RUN}`, `b2.${RUN}@bella.test`, "arbetsledare");
  const W = await createPerson(page, `Wera ${RUN}`, `bw.${RUN}@bella.test`, "arbetare");

  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const project = `Byte ${RUN}`;
  await field(page, "Projektnamn").fill(project);
  await field(page, "Projektets adress").fill("Storgatan 1, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Bygg");
  await field(page, "Startdatum").fill(NOBODY);
  await field(page, "Arbetsledare").selectOption({ label: L1.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  await signOut(page);

  await signIn(page, W.email, W.password);
  await markDays(page, [SWAP, COVER, NOBODY]);
  await signOut(page);

  await signIn(page, L1.email, L1.password);
  for (const d of [SWAP, COVER, NOBODY]) await makePass(page, project, d, W.name);
  log(`${W.name} works three past days, and ${L1.name} is on each of them automatically`);

  // ---- ROUTE 1: another arbetsledare takes the day -------------------------
  let popup = await avbokaLeader(page, SWAP, L1.name);
  await mustSee(page, `Vem ska byta ut ${L1.name}?`, "the popup does not ask the question");
  const pick = popup.getByRole("button", { name: L2.name, exact: true });
  if (!(await pick.count())) {
    await shot(page, "FAILED");
    fail(`${L2.name} is free that day and should be offered`);
  }
  if (await popup.getByRole("button", { name: L1.name, exact: true }).count()) {
    fail("the leader being replaced is offered as their own replacement");
  }
  await shot(page, "b5c-1-popup");
  log(`popup offers ${L2.name}, and not the leader being taken off`);

  await pick.click();
  await mustSee(page, `${L2.name} tog över dagen`, "the swap did not report");
  await mustSee(page, `Avboka Pass — ${L2.name}`, "the replacement is not on the day");
  log(`${L2.name} holds the day; nothing about it is flagged`);

  // ---- ROUTE 2: a worker covers -------------------------------------------
  //
  // NOT DRIVEN HERE, and the reason is worth writing down rather than leaving
  // as a gap someone finds later. Gör Arbetare Ansvarig appears only when NO
  // arbetsledare is free that day -- the spec is explicit -- and this database
  // holds every leader every previous walkthrough ever created, all of them
  // free on any past day. The condition cannot be produced without pausing
  // twenty accounts, which releases their future shifts and cascades.
  //
  // So the browser proves the RULE -- the button stays hidden while somebody
  // is free -- and the database suite proves the route: S5C.worker_ansvarig_
  // flags_the_day, S5C.ansvarig_must_be_on_the_shift, S5C.leader_cannot_flag_
  // a_day and S5C.flag_survives_confirmation, where the fixtures control who
  // exists.
  popup = await avbokaLeader(page, COVER, L1.name);
  if ((await popup.getByRole("button", { name: L2.name, exact: true }).count()) === 0) {
    fail(`${L2.name} should be free on ${COVER} and offered`);
  }
  if (await popup.getByRole("button", { name: "Gör Arbetare Ansvarig", exact: true }).count()) {
    await shot(page, "FAILED");
    fail("Gör Arbetare Ansvarig is offered while an arbetsledare is still free");
  }
  await shot(page, "b5c-2-ingen-ansvarig-annu");
  log("with a leader free, Gör Arbetare Ansvarig is not offered at all");

  // And the leader is not shown the one control that would flag the day: that
  // decision is the owner's, and offering a button the database refuses would
  // be a promise the interface cannot keep.
  if (await popup.getByRole("button", { name: "Ingen Arbetsledare", exact: true }).count()) {
    await shot(page, "FAILED");
    fail("an arbetsledare is offered Ingen Arbetsledare; that call is the admin's");
  }
  log("nor is the arbetsledare offered Ingen Arbetsledare -- that call is the admin's");

  await popup.getByRole("button", { name: "Avbryt", exact: true }).click();
  await page.waitForTimeout(800);
  await signOut(page);

  // ---- ROUTE 3: nobody, and it is the admin who says so --------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  popup = await avbokaLeader(page, NOBODY, L1.name);
  const nobody = popup.getByRole("button", { name: "Ingen Arbetsledare", exact: true });
  if (!(await nobody.count())) fail("the popup has no Ingen Arbetsledare");

  // The least prominent control on the popup, deliberately: smaller than every
  // other button on it, and underlined rather than boxed.
  const [nBox, aBox] = await Promise.all([
    nobody.boundingBox(),
    popup.getByRole("button", { name: "Avbryt", exact: true }).boundingBox(),
  ]);
  if (!(nBox.height < aBox.height)) {
    fail(`Ingen Arbetsledare (${nBox.height}px) must be less prominent than Avbryt (${aBox.height}px)`);
  }
  await shot(page, "b5c-3-ingen");
  await nobody.click();
  await mustSee(page, "Dagen körs utan arbetsledare",
    "leaving the day unsupervised did not report");
  log("Ingen Arbetsledare is the smallest control on the popup, and it flags the day");

  await signOut(page);

  // ---- the leader's queue skips it, the admin's highlights it --------------
  await signIn(page, L1.email, L1.password);
  await page.goto(`${BASE}/bekrafta/`, { waitUntil: "networkidle" });
  const queue = await page.locator("main").innerText();
  for (const d of [NOBODY]) {
    const heading = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm", weekday: "long",
    }).format(new Date(`${d}T12:00:00Z`)).toUpperCase();
    if (queue.includes(heading)) {
      await shot(page, "FAILED");
      fail(`a flagged day (${d}) is in the arbetsledare's queue`);
    }
  }
  log("the flagged day is not in the arbetsledare's queue -- there is no claim to make");
  await signOut(page);

  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`${BASE}/granska/`, { waitUntil: "networkidle" });
  await mustSee(page, "Dagen kördes", "the admin's queue does not show a flagged day");
  if (await page.getByRole("button", { name: "Underkänn", exact: true }).count()) {
    fail("a flagged day offers Underkänn; there is no claim to send back");
  }
  await mustSee(page, "Bekräfta dagen", "the admin cannot confirm the flagged day");
  await shot(page, "b5c-4-granska");
  log("the admin's queue shows it flagged, with nothing to send back");

  console.log("\nAVBOKA PASS (ARBETSLEDARE) COMPLETE.\n");
} finally {
  await browser.close();
}
