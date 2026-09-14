#!/usr/bin/env node
/**
 * Snabb Pass in a browser -- the escape hatch, driven by an ARBETSLEDARE.
 *
 * What it proves:
 *   - an ARBETSLEDARE is refused, and told so rather than shown a dead form
 *   - the ADMIN creates one
 *   - Ny Arbetare from inside the worker dropdown: same form, same
 *     copy-then-create gate, back to the shift screen to finish
 *   - the person's earlier assignment that day is released and the Snabb Pass
 *     wins -- one live assignment, never two
 *   - EFTER bekräftelse: it enters the confirmation queue and confirms like
 *     any other row -- what Snabb Pass always did, now one of two choices
 *   - FÖRE bekräftelse: on a day its own pass is alone on, the admin files it
 *     straight into the Arbetsdagbok, accepting the arbetsledare's hours on
 *     the same screen, and the day lands in NEITHER queue
 *   - pressing Före on a day somebody else works says why, rather than being
 *     a control that does nothing
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";
import { chooseProject } from "./day-page.mjs";

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

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const ymd = (n) => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};
const D = ymd(-1);   // yesterday: already over, so the day is confirmable
// Three days back, and nothing else on it. Före bekräftelse is only offered on
// a day its own pass is alone on, so the two routes need two days.
const DF = ymd(-3);

console.log(`\nSnabb Pass on ${D}, filed direkt on ${DF}\n`);

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
  await page.getByRole("button", { name: "Fortsätt", exact: true }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
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
  await field(page, "Timmar").fill("6");
  await field(page, "Vem?").selectOption("__ny__");
  await page.getByText("Skapas och läggs sedan direkt på passet").waitFor({ timeout: 20000 });

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

  await mustSee(page, "Går förbi hela turordningen",
    "did not return to the Snabb Pass form after creating the worker");
  const selected = await field(page, "Vem?").inputValue();
  if (!selected || selected === "__ny__") fail("returned without the new worker selected");
  await page.getByRole("button", { name: "Skapa Snabb Pass" }).click();
  await mustSee(page, "Snabb Pass skapat", "the Snabb Pass for the new worker failed");
  await mustSee(page, "Lösenord:", "the credentials for the new worker were not shown");
  log(`admin created ${newName} from inside the dropdown and put them on the shift`);

  // ---- and one for Ada, who already works that day --------------------------
  await page.getByRole("button", { name: "Skapa ett till" }).click();
  await field(page, "Projekt").selectOption({ label: project });
  await field(page, "Datum").fill(D);
  await field(page, "Timmar").fill("4");
  await field(page, "Vem?").selectOption({ label: `Ada S${RUN}` });
  await page.getByRole("button", { name: "Skapa Snabb Pass" }).click();
  await mustSee(page, "Snabb Pass skapat", "the second Snabb Pass failed");
  await shot(page, "42-snabb-skapat");
  log("Snabb Pass for Ada, who already had a pass that day");

  // ---- the earlier assignment is gone, exactly one stands -------------------
  await signOut(page);
  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/dag/`, { waitUntil: "networkidle" });
  await field(page, "Datum").fill(D);
  // The day shows ONE project at a time, and which one it opens on is a sort
  // order this run does not control.
  await chooseProject(page, project);
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

  // ---- FÖRE BEKRÄFTELSE: the admin files the day themselves -----------------
  // Everything above ran on D, which somebody else is working, so the screen
  // offered Efter and the flow was the old one. This is the other route.
  await signOut(page);
  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));
  await page.goto(`${BASE}/snabb/`, { waitUntil: "networkidle" });
  await field(page, "Projekt").selectOption({ label: project });

  // The shared day first. Före is not on offer there, and the press has to SAY
  // so -- a control that simply does nothing reads as a broken app.
  await field(page, "Datum").fill(D);
  await page.getByRole("button", { name: "Före bekräftelse" }).click();
  await mustSee(page, "bekräftas av arbetsledaren",
    "pressing Före on a day somebody else works said nothing at all");
  await shot(page, "45-fore-nekad");
  log("Före is refused on a shared day, and says why on the press");

  // A clean day on the same project. Changing the date clears the refusal --
  // it was about the other day.
  // Waited for rather than checked on the spot: the pass count for the new day
  // is a round trip, and asserting the instant after a keystroke would be
  // asserting that the screen is psychic rather than that it is correct.
  await field(page, "Datum").fill(DF);
  await page.getByText("bekräftas av arbetsledaren").first()
    .waitFor({ state: "hidden", timeout: 20000 })
    .catch(() => fail("the refusal about the shared day outlived the day it was about"));
  await field(page, "Vem?").selectOption({ label: `Ada S${RUN}` });
  await field(page, "Timmar").fill("7");

  // Invariant 6 and invariant 1, both on this screen because Före closes the
  // day and there is no later stage to supply either in.
  await field(page, "Vad vi gjorde").fill("Akut läckage, plan 1.");
  await field(page, `Timmar — Ledare S${RUN} (arbetsledare)`).fill("6,5");
  await shot(page, "46-fore-formularet");

  await page.getByRole("button", { name: "Skapa och för in i arbetsdagboken" }).click();
  await mustSee(page, "Snabb Pass skapat", "the Före Snabb Pass failed");
  await mustSee(page, "Dagen är förd till arbetsdagboken",
    "the screen did not say the day was filed");
  await shot(page, "47-fore-skapat");
  log(`filed ${DF} straight into the Arbetsdagbok, with the leader's own hours accepted`);

  // ---- and it is in NEITHER queue -------------------------------------------
  // Not the admin's: it never was a stage 1 claim. Not the leader's: it is
  // finished. Asserted on the DATE, because the leader has other days here.
  await page.goto(`${BASE}/bekraftelser/`, { waitUntil: "networkidle" });
  if (await page.getByText(DF, { exact: false }).count()) {
    fail(`${DF} is in the admin's review queue; a day filed direkt never enters it`);
  }
  await signOut(page);

  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/bekrafta/`, { waitUntil: "networkidle" });
  if (await page.getByText(DF, { exact: false }).count()) {
    fail(`${DF} is waiting on the arbetsledare; a day filed direkt is already confirmed`);
  }
  await shot(page, "48-fore-i-ingen-ko");
  log("the filed day is in neither queue: nobody is waiting on it");

  console.log("\nSNABB PASS WALKTHROUGH COMPLETE.\n");
} finally {
  await browser.close();
}
