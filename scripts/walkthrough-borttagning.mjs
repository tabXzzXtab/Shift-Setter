#!/usr/bin/env node
/**
 * Deleting a pass entirely -- admin only, from the shift calendar.
 *
 * The last two assertions are the reason this walkthrough exists rather than
 * living inside walkthrough-kalender: a day only reads as CANCELLED when
 * nothing survives on it, and that cannot be shown on a date this shared
 * database already has other runs' shifts on. So the days here are ~120 out,
 * and the run checks they are empty BEFORE it books anything -- if the date is
 * not clean the walkthrough says so instead of quietly proving nothing.
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
const day = (n) => sv.format(new Date(Date.now() + n * 864e5));
const TODAY = day(0);

async function reach(page, date) {
  const forward = date > TODAY;
  for (let i = 0; i < 30; i++) {
    if (await page.locator(`[data-date="${date}"]`).count()) return;
    await page.getByRole("button", {
      name: forward ? "Nästa månad" : "Föregående månad", exact: true,
    }).click();
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

/**
 * Open a day and hand back everything it says.
 *
 * `project` is optional on purpose. findCleanDays below asks about days before
 * this run has created anything, and a day with nothing on it has no tabs to
 * choose between; once the project exists, naming it is what keeps the text
 * from belonging to another run's site on the same date.
 */
async function openDay(page, date, project) {
  await openDayPage(page, BASE, date, project);
  return page.locator("main").innerText();
}

/**
 * Scoped to THIS run's project, never .first(). The day page shows one project
 * at a time, but which one is a tab away and the project runs several passes
 * here -- a stray match deletes somebody else's shift.
 * `> p` is a DIRECT child -- the panel is itself a <section> around these, so a
 * descendant match resolves to two nested elements and never settles.
 */
const deleteButton = (page, project) =>
  page.locator(`section:has(> p:text-is("${project}"))`)
      .getByRole("button", { name: /Ta bort detta pass/ });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

const PAST = day(-1);

/**
 * Two days nobody has touched.
 *
 * NOT a fixed offset. This database keeps everything every previous run of
 * every walkthrough created, including days those runs CANCELLED -- and a day
 * already reading "Inställd dag" would make the assertions below pass without
 * this run having done anything. So the days are searched for rather than
 * assumed, and a day is only clean when it says it has nothing at all.
 */
async function findCleanDays(page, count, from) {
  const found = [];
  for (let n = from; n < from + 40 && found.length < count; n++) {
    const d = day(n);
    if ((await openDay(page, d)).includes("Inga pass den dagen")) found.push(d);
  }
  if (found.length < count) {
    fail(`could not find ${count} untouched days from ${day(from)} onwards`);
  }
  return found;
}

console.log(`\nDeleting a pass at ${BASE}\n`);

try {
  // ---- the days must be mine before anything is booked on them -------------
  await signIn(page, ADMIN.email, ADMIN.password);
  const [ONE, TWO] = await findCleanDays(page, 2, 120);
  log(`${ONE} and ${TWO} start with nothing at all, so what they say later is this run's doing`);

  // ---- setup ---------------------------------------------------------------
  const L = await createPerson(page, `Lars Ledare ${RUN}`, `dl.${RUN}@bella.test`, "arbetsledare");
  const W = await createPerson(page, `Doris ${RUN}`, `dw.${RUN}@bella.test`, "arbetare");
  const W2 = await createPerson(page, `David ${RUN}`, `d2.${RUN}@bella.test`, "arbetare");

  const P = `Rivning ${RUN}`;
  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  await field(page, "Projektnamn").fill(P);
  await field(page, "Projektets adress").fill("Rivningsgatan 1, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Bygg");
  await field(page, "Startdatum").fill(PAST);
  await field(page, "Arbetsledare").selectOption({ label: L.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  await signOut(page);

  await signIn(page, W.email, W.password);
  await markDays(page, [PAST, ONE, TWO]);
  await signOut(page);

  await signIn(page, W2.email, W2.password);
  await markDays(page, [TWO]);
  await signOut(page);

  await signIn(page, L.email, L.password);
  await makePass(page, P, PAST, W.name, "07:00", "16:00");
  await makePass(page, P, ONE, W.name, "07:00", "16:00");
  await makePass(page, P, TWO, W.name, "07:00", "12:00");
  await makePass(page, P, TWO, W2.name, "13:00", "18:00");

  // ---- an arbetsledare has no such control --------------------------------
  const asLeader = await openDay(page, ONE, P);
  if (!asLeader.includes(W.name)) fail(`${W.name} should hold ${ONE}`);
  if (await deleteButton(page, P).count()) {
    await shot(page, "FAILED");
    fail("an arbetsledare is offered Ta bort detta pass; deleting is the admin's");
  }
  await shot(page, "bo1-ledare-utan-knapp");
  log("an arbetsledare cannot delete a pass -- the control is not on their screen");
  await signOut(page);

  // ---- a shift already under way is a fact, not a mistake ------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  await openDay(page, PAST, P);
  await deleteButton(page, P).waitFor({ timeout: 20000 });
  await deleteButton(page, P).click();
  await mustSee(page, "Passet har redan börjat", "a started pass was deleted");

  // ---- and the refusal is in Swedish ------------------------------------
  //
  // THE REFUSAL IS THE DATABASE'S, AND IT IS RAISED IN ENGLISH: "this shift
  // has started and cannot be deleted; it must be confirmed". Every guard in
  // this app is written that way, for whoever is reading the migration --
  // which is the right text in a log and the wrong text on a phone on a
  // building site. lib/fel.ts is what stands between the two.
  //
  // BOTH HALVES ARE ASSERTED. The sentence has to be the whole one, so a
  // truncation is caught; and no word of the raised English may be on the
  // screen, so a surface that fell back to the raw message is caught even
  // when the Swedish happens to be there too.
  const SWEDISH = "Passet har redan börjat. Det tas inte bort — det bekräftas.";
  const screen = await page.locator("body").innerText();
  if (!screen.includes(SWEDISH)) {
    await shot(page, "FAILED");
    fail(`the refusal is not the full Swedish sentence; screen holds ${JSON.stringify(
      screen.split("\n").filter((l) => /passet|shift/i.test(l)).slice(0, 3))}`);
  }
  for (const english of ["cannot be deleted", "must be confirmed", "this shift"]) {
    if (screen.toLowerCase().includes(english)) {
      await shot(page, "FAILED");
      fail(`the raw English refusal reached the screen: "${english}"`);
    }
  }
  await shot(page, "bo2-paborjat");
  log("a pass that has already started cannot be deleted -- and the refusal is Swedish, with no English behind it");

  // ---- the admin deletes the only shift on a day --------------------------
  await openDay(page, ONE, P);
  await deleteButton(page, P).click();
  await mustSee(page, "Passet är borttaget", "the future pass was not deleted");
  await shot(page, "bo3-borttaget");
  log(`the admin deleted the only pass on ${ONE}`);

  // ---- and the day says it was called off ---------------------------------
  const cancelled = await openDay(page, ONE, P);
  if (cancelled.includes("Inga pass den dagen")) {
    await shot(page, "FAILED");
    fail(`${ONE} reads as an ordinary empty day; a cancelled day is a different fact`);
  }
  for (const t of ["Inställd dag", P, "1 pass borttaget"]) {
    if (!cancelled.includes(t)) {
      await shot(page, "FAILED");
      fail(`the cancelled day should say "${t}": ${JSON.stringify(cancelled.slice(0, 400))}`);
    }
  }
  await shot(page, "bo4-installd-dag");
  log("the day reads Inställd dag, names the project and counts what went");

  // ---- one of two is not a cancelled day ----------------------------------
  await openDay(page, TWO, P);
  await deleteButton(page, P).first().click();
  await mustSee(page, "Passet är borttaget", "the first of two was not deleted");
  const stillRunning = await openDay(page, TWO, P);
  if (stillRunning.includes("Inställd dag")) {
    await shot(page, "FAILED");
    fail(`${TWO} still has a shift on it; calling the day off would be a lie`);
  }
  if (!stillRunning.includes(W2.name)) {
    fail(`${W2.name} should still be working ${TWO}: ${JSON.stringify(stillRunning.slice(0, 300))}`);
  }
  log("with one shift called off and another still running, the day carries on");

  // ---- and when the last one goes ------------------------------------------
  await deleteButton(page, P).first().click();
  await mustSee(page, "Passet är borttaget", "the second of two was not deleted");
  const bothGone = await openDay(page, TWO, P);
  if (!bothGone.includes("Inställd dag") || !bothGone.includes("2 pass borttagna")) {
    await shot(page, "FAILED");
    fail(`${TWO} should now be cancelled, counting both: ${JSON.stringify(bothGone.slice(0, 400))}`);
  }
  await shot(page, "bo5-bada-borta");
  log("once the last shift goes the day turns cancelled, and counts both");
  await signOut(page);

  // ---- the people who were on it are told ---------------------------------
  await signIn(page, W.email, W.password);
  await mustSee(page, "borttaget", "the worker was not told their pass was removed");
  await shot(page, "bo6-arbetaren-meddelad");
  log(`${W.name} is told on their landing page that a pass was removed`);

  // Not asserting on Mina Pass here. The worker still has the PAST day on this
  // same project, so the project name is legitimately still on that screen, and
  // an assertion that could pass because a substring happened to match is worse
  // than no assertion. What "never re-offered" means is enforced by pass_block
  // and proved by DEL.no_reoffer_enforced, where it can be stated exactly.

  console.log("\nBORTTAGNING COMPLETE.\n");
} finally {
  await browser.close();
}
