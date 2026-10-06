#!/usr/bin/env node
/**
 * Snabb Pass in a browser -- the escape hatch, driven by an ARBETSLEDARE.
 *
 * What it proves:
 *   - an ARBETSLEDARE is refused, and told so rather than shown a dead form
 *   - the ADMIN creates one
 *   - Ny Arbetare from inside the worker dropdown: same form, same
 *     copy-then-create gate, back to the shift screen to finish
 *   - A CLASH IS REFUSED, NOT RESOLVED (20261006100000): a Snabb Pass whose
 *     hours overlap the person's existing shift shows the shift in the way and
 *     keeps Skapa disabled; moved clear of it, it saves, and BOTH shifts stand
 *   - it enters the confirmation queue and confirms like any other row
 *   - there is no "Generera arbetsdagbok direkt" choice any more (owner's
 *     decision, 2026-10-06): every Snabb Pass goes to the arbetsledare
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";
import { openDayPage } from "./day-page.mjs";
import { reachDate, runLane, shiftDays, stockholmToday } from "./wt-dates.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
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
  const password = (await page.locator("[data-password]").first().innerText()).trim();
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

// A LANE, so two sweeps do not write to the same day. This one only ever goes
// FURTHER BACK: D has to be over already so the day is confirmable.
//
// This is the script that made the problem visible: 2026-09-27 reached 24
// projects across a few sweeps, and step 07 could no longer find its own
// project on the day.
const today = stockholmToday();
const LANE = runLane(RUN, 45);
const D = shiftDays(today, -1 - LANE);   // already over, so the day is confirmable

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
  // Earlier beställare are a picker now; "Ny beställare" opens the fields. __ny_best_opened__
  await page.locator('label:has(span:text-is("Beställare")) select, label:has(span:text-is("Beställarens bolag")) input').first().waitFor({ state: "attached", timeout: 20000 });
  if (await page.locator('label:has(span:text-is("Beställare")) select').count()) {
    await field(page, "Beställare").selectOption("__ny__");
  }
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Startdatum").fill(today);
  await field(page, "Arbetsledare").selectOption({ label: `Ledare S${RUN}` });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  log(`created project "${project}"`);
  await signOut(page);

  // ---- W1 marks the day and takes an ordinary pass on it --------------------
  await signIn(page, W1.email, W1.password);
  await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
  // The lane can put D in an earlier month, so page to it rather than waiting
  // for a cell this month was never going to draw.
  await reachDate(page, D, fail);
  const cell = page.locator(`[data-date="${D}"]`);
  await cell.waitFor({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1200);
  await signOut(page);

  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Välj dagar" }).waitFor({ timeout: 20000 });
  await reachDate(page, D, fail);
  const c2 = page.locator(`[data-date="${D}"]`);
  await c2.scrollIntoViewIfNeeded();
  const b2 = await c2.boundingBox();
  await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.getByRole("button", { name: "Fortsätt", exact: true }).click();
  await page.getByRole("heading", { name: "Beskriv passen" }).waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: project });
  await page.getByLabel("Timmar på rad 1").fill("8");
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "1 av 1 platser tillsatta", "the ordinary pass was not filled by the tiers");
  log(`ordinary pass on ${D}, filled from förval by Ada`);

  // ---- the leader is refused ------------------------------------------------
  // Snabb Pass is admin only: creating one is inseparable from adding someone
  // off-roster, and that creates an account.
  await page.goto(`${BASE}/snabb/`, { waitUntil: "networkidle" });
  await mustSee(page, "Endast administratören kan skapa Snabb Pass",
    "an arbetsledare should be told Snabb Pass is not theirs");
  if (await page.getByRole("button", { name: "Skapa Snabb Pass" }).count()) {
    fail("the leader was shown a Snabb Pass form the database would refuse");
  }
  await shot(page, "41-snabb-nekad-ledare");
  log("arbetsledare is told Snabb Pass is admin only, and gets no form");
  await signOut(page);

  // ---- the admin covers the no-show, with an off-roster worker --------------
  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));
  await page.goto(`${BASE}/snabb/`, { waitUntil: "networkidle" });
  await field(page, "Projekt").selectOption({ label: project });
  await field(page, "Datum").fill(D);
  await page.keyboard.press("Escape");   // close the date card before the next control
  await field(page, "Timmar").fill("6");
  await field(page, "Vem?").selectOption("__ny__");
  await page.getByRole("heading", { name: "Skapa ett konto" }).waitFor({ timeout: 20000 });

  const newName = `Bo S${RUN}`;
  await field(page, "Namn").fill(newName);
  await field(page, "E-post").fill(`bo.${RUN}@bella.test`);

  // THE GATE IS A LIVE CONTROL, NOT A DISABLED BUTTON. A disabled button
  // swallows the press and the screen cannot answer, which reads as broken
  // rather than as a step not yet done -- so this asserts that the press is
  // HEARD and refused in words, and that no account came of it.
  const create = page.getByRole("button", { name: "Tillverka arbetare" });
  await create.click();
  await mustSee(page, "Kopiera inloggningen först",
    "Tillverka arbetare was pressed before the login was copied and said nothing");
  if (await page.getByText("Lösenord:").count()) {
    fail("an account was created before anybody had its login");
  }
  await page.getByRole("button", { name: /Kopiera inloggning/ }).click();
  await shot(page, "40-snabb-ny-arbetare");
  await create.click();

  await mustSee(page, "Sätt in någon på ett pass",
    "did not return to the Snabb Pass form after creating the worker");
  const selected = await field(page, "Vem?").inputValue();
  if (!selected || selected === "__ny__") fail("returned without the new worker selected");
  await page.getByRole("button", { name: "Skapa Snabb Pass" }).click();
  await mustSee(page, "Passet är inlagt", "the Snabb Pass for the new worker failed");
  await mustSee(page, "Lösenord:", "the credentials for the new worker were not shown");
  log(`admin created ${newName} from inside the dropdown and put them on the shift`);

  // ---- and one for Ada, who already works 07:00-16:00 that day -------------
  await page.getByRole("button", { name: "Skapa ett till" }).click();
  // No direkt card any more: every Snabb Pass goes to the arbetsledare.
  if (await page.getByText("Generera arbetsdagbok direkt", { exact: false }).count()) {
    fail('the "Generera arbetsdagbok direkt" card is still on the Snabb Pass screen');
  }
  await field(page, "Projekt").selectOption({ label: project });
  await field(page, "Datum").fill(D);
  await page.keyboard.press("Escape");   // close the date card before the next control
  await field(page, "Vem?").selectOption({ label: `Ada S${RUN}` });

  // SAME HOURS AS HER SHIFT: refused before the press, the shift named, and
  // Skapa disabled -- nothing is replaced.
  await mustSee(page, "Krockar med ett annat pass",
    "a Snabb Pass across Ada's own shift showed no clash");
  await mustSee(page, `${project} 07:00–16:00`, "the clash does not name the shift in the way");
  const skapa = page.getByRole("button", { name: "Skapa Snabb Pass" });
  if (!(await skapa.isDisabled())) fail("Skapa Snabb Pass is pressable while the hours clash");
  await shot(page, "42-snabb-krock");
  log("a clash with Ada's 07:00-16:00 is named on screen and Skapa is disabled");

  // MOVED CLEAR OF IT: the refusal goes, and an evening shift on the same day
  // is allowed (invariant 2: overlap, not the date, is the rule).
  await field(page, "Börjar").fill("17:00");
  await page.keyboard.press("Escape");
  await field(page, "Slutar").fill("21:00");
  await page.keyboard.press("Escape");
  await page.getByText("Krockar med ett annat pass").first()
    .waitFor({ state: "hidden", timeout: 20000 })
    .catch(() => fail("the clash outlived the change of hours"));
  await field(page, "Timmar").fill("3,5");
  await skapa.click();
  await mustSee(page, "Passet är inlagt", "the evening Snabb Pass for Ada failed");
  await shot(page, "42-snabb-skapat");
  log("moved to 17:00-21:00, the Snabb Pass for Ada saved");

  // ---- nothing was taken away: both of Ada's shifts stand -------------------
  await signOut(page);
  await signIn(page, L.email, L.password);
  // The project's day on D: its passes and who stands on them.
  await openDayPage(page, BASE, D, project);
  if (await page.getByText("0 av 1 platser", { exact: false }).count()) {
    fail("a pass on the day lost its worker; a Snabb Pass must never release anybody");
  }
  const adaRows = await page.getByText(`Ada S${RUN}`, { exact: false }).count();
  if (adaRows !== 2) fail(`Ada appears ${adaRows} times on ${D}; her morning and her evening should both stand`);
  await shot(page, "43-dagen-efter-snabb");
  log("the morning shift is untouched; Ada holds two shifts that day");

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
