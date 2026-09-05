#!/usr/bin/env node
/**
 * Drive the bristsurvey in a real browser.
 *
 *   admin creates a project -> leader creates a pass -> the day happens ->
 *   NOBODY confirms it -> admin tries to generate and is stopped ->
 *   warning -> whose job this was -> one question per day -> the document.
 *
 * The three screens are the point. Their order, their wording and which button
 * is the heavy one all carry the argument the spec makes: chasing the leader is
 * the right outcome, and taking the day off him is the recessive option.
 *
 * Artifacts land in artifacts/.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/Shift-Setter";
const ART = "artifacts";

const ADMIN = {
  email: required("WALKTHROUGH_ADMIN_EMAIL"),
  password: required("WALKTHROUGH_ADMIN_PASSWORD"),
};
const RUN = Date.now().toString().slice(-6);

mkdirSync(ART, { recursive: true });

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };

const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

async function mustSee(page, text, why) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 20000 });
  } catch {
    await page.screenshot({ path: path.join(ART, "FAILED.png"), fullPage: true });
    fail(`${why} (never saw "${text}"; see artifacts/FAILED.png)`);
  }
}

async function mustNotSee(page, text, why) {
  await page.waitForTimeout(1500);
  if (await page.getByText(text, { exact: false }).count()) {
    await page.screenshot({ path: path.join(ART, "FAILED.png"), fullPage: true });
    fail(`${why} (saw "${text}"; see artifacts/FAILED.png)`);
  }
}

const shot = async (page, name) =>
  page.screenshot({ path: path.join(ART, `${name}.png`), fullPage: true });

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
  // Since the landing pages were rebuilt, Logga ut lives behind the profile
  // icon on every role that has one.
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
  const block = await page.locator("pre").first().innerText();
  const password = /Lösenord:\s*(\S+)/.exec(block)?.[1];
  if (!password) fail(`no password in the credential block:\n${block}`);
  await page.getByRole("button", { name: "Tillverka arbetare" }).click();
  await page.getByText("Klar", { exact: false }).first().waitFor({ timeout: 20000 });
  return { email, password, name };
}

/** Open the Arbetsdagbok picker on the range under test and press Generera. */
async function askForTheDocument(page, projectName, day) {
  await page.goto(`${BASE}/arbetsdagbok/`, { waitUntil: "networkidle" });
  await field(page, "Projekt").selectOption({ label: projectName });
  await field(page, "Från och med").fill(day);
  await field(page, "Till och med").fill(day);
  await page.getByRole("button", { name: "Generera Arbetsdagbok" }).click();
}

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["Pixel 7"],
  locale: "sv-SE",
  timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

const yesterday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" })
  .format(new Date(Date.now() - 864e5));

console.log(`\nWalking the bristsurvey at ${BASE}\n`);

try {
  // ---- A DAY NOBODY CONFIRMS ----------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  const leader = await createPerson(page, `Lars Ledare ${RUN}`, `bl.${RUN}@bella.test`, "arbetsledare");
  const worker = await createPerson(page, `Anna Arbetare ${RUN}`, `ba.${RUN}@bella.test`, "arbetare");
  log(`created ${leader.name} and ${worker.name}`);

  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const projectName = `Fasad Svedala ${RUN}`;
  await field(page, "Projektnamn").fill(projectName);
  await field(page, "Projektets adress").fill("Storgatan 12, 233 30 Svedala");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Fasadarbete");
  await field(page, "Startdatum").fill(yesterday);
  await field(page, "Arbetsledare").selectOption({ label: leader.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  log(`created project "${projectName}"`);
  await signOut(page);

  await signIn(page, worker.email, worker.password);
  await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Kan jobba", exact: true }).click();
  const cal = page.locator(`[data-date="${yesterday}"]`);
  await cal.waitFor({ timeout: 20000 });
  const cb = await cal.boundingBox();
  await page.touchscreen.tap(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.waitForTimeout(1200);
  log(`worker marked ${yesterday} as one they can work`);
  await signOut(page);

  await signIn(page, leader.email, leader.password);
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  const cell = page.locator(`[data-date="${yesterday}"]`);
  await cell.waitFor({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("button", { name: /Klar, / }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: projectName });
  await page.getByLabel("Timmar på rad 1").fill("8");
  await page.getByRole("button", { name: worker.name, exact: true }).click();
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "1 av 1 platser tillsatta", "the priority list did not fill the slot");
  log("leader created the pass, then went silent -- nobody confirms the day");
  await signOut(page);

  // ---- STEP 1: THE WARNING -------------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  await askForTheDocument(page, projectName, yesterday);

  await mustSee(page,
    "Att generera en obekräftad arbetsdagbok riskerar att du bokför obekräftade",
    "an unconfirmed range generated with no warning at all");
  await shot(page, "b1-varningen");
  log("stopped before generation: the warning names what he is about to book");

  // Nej goes back to Alla Projekt. The screen would rather he did this.
  await page.getByRole("button", { name: "Nej", exact: true }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  log("Nej leaves for Alla Projekt");

  // ---- STEP 2: WHOSE JOB THIS WAS -----------------------------------------
  await askForTheDocument(page, projectName, yesterday);
  await page.getByRole("button", { name: "Ja", exact: true }).click();

  await mustSee(page, "Passen du begär om har inte blivit bekräftade av",
    "the survey never named whose job the confirmation was");
  await mustSee(page, leader.name, "the screen must name the leader who owes it");
  await shot(page, "b2-vems-jobb");
  log(`screen 2 names ${leader.name}, the leader who owed the confirmation`);

  // Tillbaka is the heavy button, and it goes back rather than on.
  await page.getByRole("button", { name: "Tillbaka", exact: true }).click();
  await mustNotSee(page, "Passen du begär om", "Tillbaka did not close the survey");
  await mustSee(page, "Generera Arbetsdagbok", "Tillbaka should land back on the picker");
  log("Tillbaka -- the heavier button -- goes back, it does not go on");

  // ---- STEP 3: THE SURVEY --------------------------------------------------
  await page.getByRole("button", { name: "Generera Arbetsdagbok" }).click();
  await page.getByRole("button", { name: "Ja", exact: true }).click();
  await page.getByRole("button", { name: "Bekräfta Uppgifter" }).click();

  await mustSee(page, `Vad har ni uppfyllt på ${projectName} den`,
    "the survey did not ask the day's question");

  // Nobody clocked, so the figures fall back to what was planned -- and the
  // admin is shown them before they are booked in his name.
  await mustSee(page, "07:00-16:00", "the registered times were not shown");
  await mustSee(page, "8 h (planerat)",
    "the survey must show the figure it is about to book, and where it came from");
  await shot(page, "b3-fragan");
  log("screen 3 asks one day's question and shows the figures it will book");

  const account = "Bytte ut rötskadad panel på norra gaveln och grundmålade.";
  await page.getByRole("textbox").first().fill(account);
  await page.getByRole("button", { name: "Bekräfta dagen" }).click();

  // ---- THE DOCUMENT --------------------------------------------------------
  await page.getByRole("button", { name: /Ladda ner PDF/ }).waitFor({ timeout: 30000 });
  await page.waitForLoadState("networkidle");
  await mustSee(page, account, "the surveyed day's account is not in the document");
  await shot(page, "b4-dokumentet");
  log("the survey satisfied invariant 6 and the document generated");

  await signOut(page);

  // ---- IT LEFT THE QUEUE, AND NEVER COMES BACK -----------------------------
  await signIn(page, leader.email, leader.password);
  await page.goto(`${BASE}/bekrafta/`, { waitUntil: "networkidle" });
  await mustSee(page, "Inget att bekräfta",
    "a surveyed day must leave the leader's queue permanently");
  await shot(page, "b5-kon-ar-tom");
  log("the surveyed day is gone from the leader's queue for good");

  await signOut(page);

  // ---- THE WARNING GUARDS THIS PATH ONLY -----------------------------------
  // A warning that fires when nothing is wrong is one nobody reads by the third
  // time. The same range is confirmed now, so it must generate with nothing in
  // the way.
  await signIn(page, ADMIN.email, ADMIN.password);
  await askForTheDocument(page, projectName, yesterday);
  await page.getByRole("button", { name: /Ladda ner PDF/ }).waitFor({ timeout: 30000 });
  await mustNotSee(page, "Att generera en obekräftad arbetsdagbok",
    "the warning fired on a range where nothing was wrong");
  log("a range with nothing wrong generates straight through, no popup");

  console.log("\nBRISTSURVEY WALKTHROUGH COMPLETE -- every screen did what it should.\n");
} finally {
  await browser.close();
}
