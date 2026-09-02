#!/usr/bin/env node
/**
 * Drive förval, the priority tiers and Acceptera Pass in a real browser.
 *
 * The scenario is built so each tier rule is the ONLY thing that can explain
 * the outcome:
 *
 *   W1  drags three days on their calendar        -> pre-picked, not hand-picked
 *   W2  taps the one day                          -> pre-picked AND hand-picked
 *   W3  marks nothing, but IS hand-picked         -> no entry ticket, no slot
 *
 *   Two slots. If hand-picking were a grant rather than a ranking modifier, W3
 *   would take one and W1 would not be on the shift at all.
 *
 * Then a day nobody pre-picked, to see the shortfall warning at creation and
 * the card arriving in Acceptera Pass.
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
  try { await page.getByText(text, { exact: false }).first().waitFor({ timeout: 20000 }); }
  catch {
    await shot(page, "FAILED-tiers");
    fail(`${why} (never saw "${text}"; see artifacts/FAILED-tiers.png)`);
  }
}
async function mustNotSee(page, text, why) {
  await page.waitForTimeout(1200);
  if (await page.getByText(text, { exact: false }).count()) {
    await shot(page, "FAILED-tiers");
    fail(`${why} (saw "${text}" and should not have)`);
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
  const block = await page.locator("pre").first().innerText();
  const password = /Lösenord:\s*(\S+)/.exec(block)?.[1];
  if (!password) fail(`no password in credential block for ${name}`);
  await page.getByRole("button", { name: "Tillverka arbetare" }).click();
  await page.getByText("Klar", { exact: false }).first().waitFor({ timeout: 20000 });
  return { email, password };
}

/** Paint days by dragging the finger across the grid, as a worker would. */
async function paintDays(page, dates, mode = "Kan jobba") {
  await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: mode, exact: true }).click();
  const cells = [];
  for (const d of dates) {
    const cell = page.locator(`[data-date="${d}"]`);
    await cell.waitFor({ timeout: 20000 });
    cells.push(await cell.boundingBox());
  }
  const mid = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

  await page.mouse.move(...Object.values(mid(cells[0])));
  await page.mouse.down();
  for (const b of cells.slice(1)) {
    const m = mid(b);
    await page.mouse.move(m.x, m.y, { steps: 6 });
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);   // the drag commits on release
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

// Dates inside the current month, so the calendar needs no navigation.
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const plus = (n) => {
  const [y, m, d] = today.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n, 12));
  return t.toISOString().slice(0, 10);
};
const D = plus(13);            // the contested day
const D2 = plus(20);           // the day nobody pre-picks
if (D.slice(0, 7) !== today.slice(0, 7) || D2.slice(0, 7) !== today.slice(0, 7)) {
  fail("this run straddles a month boundary; the calendar would need paging");
}

console.log(`\nTiers on ${D}, Acceptera Pass on ${D2}\n`);

try {
  // ---- admin sets it up ----------------------------------------------------
  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));
  const L = await createPerson(page, `Ledare T${RUN}`, `lt.${RUN}@bella.test`, "arbetsledare");
  const W1 = await createPerson(page, `Ada T${RUN}`, `ada.${RUN}@bella.test`, "arbetare");
  const W2 = await createPerson(page, `Bo T${RUN}`, `bo.${RUN}@bella.test`, "arbetare");
  const W3 = await createPerson(page, `Cim T${RUN}`, `cim.${RUN}@bella.test`, "arbetare");
  log("created one arbetsledare and three arbetare");

  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const project = `Tegelbruket ${RUN}`;
  await field(page, "Projektnamn").fill(project);
  await field(page, "Projektets adress").fill("Bruksgatan 8, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Murning");
  await field(page, "Startdatum").fill(today);
  await field(page, "Arbetsledare").selectOption({ label: `Ledare T${RUN}` });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  log(`created project "${project}"`);
  await signOut(page);

  // ---- workers paint förval ------------------------------------------------
  await signIn(page, W1.email, W1.password);
  await paintDays(page, [plus(12), D, plus(14)]);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(`[data-date="${D}"][aria-label*="kan jobba"]`).waitFor({ timeout: 20000 });
  // ...and marks the OTHER day as one they cannot work. Three states on one
  // screen, and an explicit no that Acceptera Pass must respect later.
  await paintDays(page, [D2], "Kan inte");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(`[data-date="${D2}"][aria-label*="kan inte"]`).waitFor({ timeout: 20000 });
  await shot(page, "20-kalender-dragen");
  log("W1 dragged three days as can-work and marked one as cannot");
  await signOut(page);

  await signIn(page, W2.email, W2.password);
  await paintDays(page, [D]);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(`[data-date="${D}"][aria-label*="kan jobba"]`).waitFor({ timeout: 20000 });
  log("W2 marked the one day");
  await signOut(page);

  // W3 marks nothing at all.

  // ---- leader creates demand ------------------------------------------------
  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await field(page, "Projekt").selectOption({ label: project });
  await field(page, "Datum").fill(D);
  await field(page, "Timmar").fill("8");
  await page.getByRole("button", { name: "Fler" }).click();          // headcount 2
  await mustSee(page, "2 arbetare har markerat den dagen", "the coverage count is wrong");

  // Hand-pick W2 (who pre-picked) and W3 (who did not).
  await page.getByRole("button", { name: `Bo T${RUN}`, exact: true }).click();
  await page.getByRole("button", { name: `Cim T${RUN}`, exact: true }).click();
  await shot(page, "21-skapa-pass-handplock");
  await page.getByRole("button", { name: "Skapa pass" }).click();

  await mustSee(page, "2 av 2 platser tillsatta", "the tiers did not fill both slots");
  await shot(page, "22-tillsatta");
  log("both slots filled from the förval list");
  await signOut(page);

  // ---- who actually got it --------------------------------------------------
  await signIn(page, W2.email, W2.password);
  await page.goto(`${BASE}/mina-pass/`, { waitUntil: "networkidle" });
  await mustSee(page, project, "W2 was hand-picked AND pre-picked, and should hold the shift");
  log("W2 (hand-picked with förval, Tier 1) holds the shift");
  await signOut(page);

  await signIn(page, W1.email, W1.password);
  await page.goto(`${BASE}/mina-pass/`, { waitUntil: "networkidle" });
  await mustSee(page, project, "W1 pre-picked and should have taken the second slot");
  log("W1 (pre-picked only, Tier 2) holds the second slot");
  await signOut(page);

  await signIn(page, W3.email, W3.password);
  await page.goto(`${BASE}/mina-pass/`, { waitUntil: "networkidle" });
  await mustNotSee(page, project,
    "W3 was hand-picked but never marked the day -- hand-picking is not a grant");
  log("W3 (hand-picked, no förval) got nothing, as the förval is the entry ticket");

  // ---- a day nobody pre-picked ---------------------------------------------
  await signOut(page);
  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await field(page, "Projekt").selectOption({ label: project });
  await field(page, "Datum").fill(D2);
  await field(page, "Timmar").fill("8");
  // W1 said no to this day, so nobody is available on it.
  await mustSee(page, "Bara 0 arbetare har markerat den dagen",
    "the shortfall was not flagged at creation");
  await shot(page, "23-brist-varning");
  log("shortfall flagged before the pass was generated");

  await page.getByRole("button", { name: "Skapa pass" }).click();
  await mustSee(page, "0 av 1 platser tillsatta", "an empty förval list should assign nobody");
  await mustSee(page, "Acceptera Pass", "the slot should have gone out as Acceptera Pass");
  log("nobody assigned; the slot went out as Acceptera Pass");
  await signOut(page);

  // ---- a worker takes it ----------------------------------------------------
  await signIn(page, W3.email, W3.password);
  await page.goto(`${BASE}/acceptera/`, { waitUntil: "networkidle" });
  await mustSee(page, project, "the card never reached Acceptera Pass");
  await mustSee(page, D2, "the card should show the date");
  await mustSee(page, "Bruksgatan 8", "the card should show the address");
  await shot(page, "24-acceptera-kort");

  await page.getByRole("button", { name: "Ta passet" }).click();
  await mustSee(page, "Passet är ditt", "accepting did not take the slot");
  log("W3 accepted the card");

  await page.goto(`${BASE}/mina-pass/`, { waitUntil: "networkidle" });
  await mustSee(page, D2, "the accepted shift should now be theirs");
  await shot(page, "25-accepterat-pass");
  log("the accepted shift is an ordinary shift on their list");

  // ---- an explicit no is not asked again -----------------------------------
  await signOut(page);
  await signIn(page, W1.email, W1.password);
  await page.goto(`${BASE}/acceptera/`, { waitUntil: "networkidle" });
  await mustNotSee(page, project,
    "W1 marked that day cannot-work, so the card must never be offered to them");
  log("W1, who marked the day cannot-work, was never offered it");

  console.log("\nTIER WALKTHROUGH COMPLETE -- every rule produced its own outcome.\n");
} finally {
  await browser.close();
}
