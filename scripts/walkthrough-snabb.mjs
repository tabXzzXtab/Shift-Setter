#!/usr/bin/env node
/**
 * Snabb Pass in a browser -- the escape hatch, driven by an ARBETSLEDARE.
 *
 * What it proves:
 *   - a leader, not just the admin, can create one (Section 2 once said
 *     otherwise; Step 7 says both, and Step 7 is right)
 *   - Ny Arbetare from inside the worker dropdown: same form, same
 *     copy-then-create gate, back to the shift screen to finish
 *   - the person's earlier assignment that day is released and the Snabb Pass
 *     wins -- one live assignment, never two
 *   - it still enters the confirmation queue and confirms like any other row
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/Shift-Setter";
const ART = "artifacts";
const RUN = Date.now().toString().slice(-6);
mkdirSync(ART, { recursive: true });

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };

const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();
const shot = (page, name) => page.screenshot({ path: path.join(ART, `${name}.png`), fullPage: true });

async function mustSee(page, text, why) {
  try { await page.getByText(text, { exact: false }).first().waitFor({ timeout: 25000 }); }
  catch {
    await shot(page, "FAILED-snabb");
    const seen = await page.locator("main, body").first().innerText().catch(() => "(nothing)");
    fail(`${why} (never saw "${text}")\n--- screen ---\n${seen.slice(0, 800)}`);
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
  return { email, password };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const ymd = (n) => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};
const D = ymd(-1);   // yesterday: already over, so the day is confirmable

console.log(`\nSnabb Pass on ${D}\n`);

try {
  // ---- setup ----------------------------------------------------------------
  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));
  const L = await createPerson(page, `Ledare S${RUN}`, `ls.${RUN}@bella.test`, "arbetsledare");
  const W1 = await createPerson(page, `Ada S${RUN}`, `ada.${RUN}@bella.test`, "arbetare");
  log("created an arbetsledare and one arbetare");

  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const project = `Akutjobbet ${RUN}`;
  await field(page, "Projektnamn").fill(project);
  await field(page, "Projektets adress").fill("Bruksgatan 8, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Akut");
  await field(page, "Startdatum").fill(today);
  await field(page, "Arbetsledare").selectOption({ label: `Ledare S${RUN}` });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  log(`created project "${project}"`);
  await signOut(page);

  // ---- W1 marks the day and takes an ordinary pass on it --------------------
  await signIn(page, W1.email, W1.password);
  await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
  const cell = page.locator(`[data-date="${D}"]`);
  await cell.waitFor({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1200);
  await signOut(page);

  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  const c2 = page.locator(`[data-date="${D}"]`);
  await c2.scrollIntoViewIfNeeded();
  const b2 = await c2.boundingBox();
  await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.getByRole("button", { name: /Klar, / }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: project });
  await page.getByLabel("Timmar på rad 1").fill("8");
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "1 av 1 platser tillsatta", "the ordinary pass was not filled by the tiers");
  log(`ordinary pass on ${D}, filled from förval by Ada`);

  // ---- the LEADER covers a no-show with someone already on the roster -------
  // A leader picks from the roster: creating a worker creates an account, and
  // that stays admin-only (Section 2). The dropdown does not even offer it.
  await page.goto(`${BASE}/snabb/`, { waitUntil: "networkidle" });
  await mustSee(page, "Endast administratören kan lägga till",
    "a leader should be told they cannot add someone off-roster");
  if (await page.locator('select option[value="__ny__"]').count()) {
    fail("the leader was offered Ny Arbetare, which creates an account");
  }
  await field(page, "Projekt").selectOption({ label: project });
  await field(page, "Datum").fill(D);
  await field(page, "Timmar").fill("4");
  await field(page, "Vem?").selectOption({ label: `Ada S${RUN}` });
  await shot(page, "41-snabb-formular");
  await page.getByRole("button", { name: "Skapa Snabb Pass" }).click();
  await mustSee(page, "Snabb Pass skapat", "the arbetsledare could not create a Snabb Pass");
  await shot(page, "42-snabb-skapat");
  log("arbetsledare created a Snabb Pass for Ada, who already worked that day");
  await signOut(page);

  // ---- the ADMIN adds someone who is not on the roster at all ---------------
  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));
  await page.goto(`${BASE}/snabb/`, { waitUntil: "networkidle" });
  await field(page, "Projekt").selectOption({ label: project });
  await field(page, "Datum").fill(D);
  await field(page, "Timmar").fill("6");
  await field(page, "Vem?").selectOption("__ny__");
  await page.getByText("Skapas och läggs sedan direkt på passet").waitFor({ timeout: 20000 });

  const newName = `Bo S${RUN}`;
  await field(page, "Namn").fill(newName);
  await field(page, "E-post").fill(`bo.${RUN}@bella.test`);

  const create = page.getByRole("button", { name: "Tillverka arbetare" });
  if (await create.isEnabled()) fail("Tillverka Arbetare was pressable before the login was copied");
  await page.getByRole("button", { name: /Kopiera inloggning/ }).click();
  await shot(page, "40-snabb-ny-arbetare");
  await create.click();

  // Back on the shift screen, with them selected, as though nothing happened.
  await mustSee(page, "Går förbi hela turordningen",
    "did not return to the Snabb Pass form after creating the worker");
  const selected = await field(page, "Vem?").inputValue();
  if (!selected || selected === "__ny__") fail("returned without the new worker selected");
  log(`admin created ${newName} from inside the dropdown and returned to the shift`);

  await page.getByRole("button", { name: "Skapa Snabb Pass" }).click();
  await mustSee(page, "Snabb Pass skapat", "the Snabb Pass for the new worker failed");
  await mustSee(page, "Lösenord:", "the credentials for the new worker were not shown");
  log("Snabb Pass created for a worker who was not on the roster a minute ago");

  // ---- the earlier assignment is gone, exactly one stands -------------------
  await signOut(page);
  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/dag/`, { waitUntil: "networkidle" });
  await field(page, "Datum").fill(D);
  await mustSee(page, "0 av 1 platser", "the ordinary pass should have lost its worker");
  const adaRows = await page.getByText(`Ada S${RUN}`, { exact: false }).count();
  if (adaRows !== 1) fail(`Ada appears ${adaRows} times on ${D}; the Snabb Pass must win, not duplicate`);
  await shot(page, "43-dagen-efter-snabb");
  log("the earlier assignment was released; Ada holds exactly one pass that day");

  // ---- it still has to be confirmed -----------------------------------------
  await page.goto(`${BASE}/bekrafta/`, { waitUntil: "networkidle" });
  await mustSee(page, `Bo S${RUN}`, "the Snabb Pass did not enter the confirmation queue");
  await mustSee(page, `Ada S${RUN}`, "Ada's Snabb Pass did not enter the confirmation queue");
  await shot(page, "44-snabb-i-bekrafta");
  log("both Snabb Pass rows are in the confirmation queue, like any other");

  console.log("\nSNABB PASS WALKTHROUGH COMPLETE.\n");
} finally {
  await browser.close();
}
