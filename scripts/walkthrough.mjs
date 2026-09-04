#!/usr/bin/env node
/**
 * Drive the whole vertical slice in a real browser, as each role in turn.
 *
 *   admin creates a project -> arbetsledare creates a pass ->
 *   worker clocks in and out -> arbetsledare confirms the day ->
 *   admin generates the Arbetsdagbok and gets a PDF.
 *
 * "Typecheck clean" is not a status report. This clicks the actual buttons
 * against the actual database, and fails loudly the moment a step does not
 * produce what it should.
 *
 * Screenshots land in artifacts/, and the PDF is printed from Chromium's own
 * print engine -- the same one the admin's browser will use.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/Shift-Setter";
const ART = "artifacts";

// From .env.local, never inlined here: this repository is public, and a
// working admin login committed to it is a working admin login for anyone.
const ADMIN = {
  email: required("WALKTHROUGH_ADMIN_EMAIL"),
  password: required("WALKTHROUGH_ADMIN_PASSWORD"),
};
const RUN = Date.now().toString().slice(-6);

mkdirSync(ART, { recursive: true });

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };

/** The label text sits in a span inside the label, next to the control. */
const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

/**
 * Wait for text to appear, then assert. A bare count() reads the DOM before the
 * fetch behind it has resolved, which fails a screen that is merely slow rather
 * than wrong -- and, worse, would pass one that is wrong but slow to say so.
 */
async function mustSee(page, text, why) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 20000 });
  } catch {
    await page.screenshot({ path: path.join(ART, "FAILED.png"), fullPage: true });
    fail(`${why} (never saw "${text}"; see artifacts/FAILED.png)`);
  }
}

/**
 * The Timmar cell on Mina pass, read whole and compared exactly.
 *
 * getByText matches substrings, so asserting "8 h" would also pass on "18 h",
 * and asserting the absence of "8 h" would fail on an unrelated "18 h". This
 * field has three states and the difference between them is the invariant, so
 * it is read as one cell and compared in full.
 */
async function mustReadHours(page, expected, why) {
  const dd = page.locator('div:has(> dt:text-is("Timmar")) > dd').first();
  await dd.waitFor({ timeout: 20000 });
  let got = "";
  // The row renders before the fetch behind it resolves; poll rather than
  // read once, or a slow screen fails as a wrong one.
  for (let n = 0; n < 20; n++) {
    got = (await dd.innerText()).trim();
    if (got === expected) return;
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(ART, "FAILED.png"), fullPage: true });
  fail(`${why} (Timmar said "${got}", expected "${expected}")`);
}


const shot = async (page, name) => {
  await page.screenshot({ path: path.join(ART, `${name}.png`), fullPage: true });
};

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

/** Create a worker or leader, returning the credentials the admin copied. */
async function createPerson(page, name, email, role) {
  await page.goto(`${BASE}/arbetare/ny/`, { waitUntil: "networkidle" });
  await field(page, "Namn").fill(name);
  await field(page, "E-post").fill(email);
  await field(page, "Roll").selectOption(role);

  // Kopiera Inloggning gates Tillverka Arbetare: an account whose credentials
  // nobody holds is an account nobody can use.
  const create = page.getByRole("button", { name: "Tillverka arbetare" });
  if (await create.isEnabled()) fail(`"Tillverka arbetare" was pressable before the login was copied`);

  await page.getByRole("button", { name: /Kopiera inloggning/ }).click();
  const block = await page.locator("pre").first().innerText();
  const password = /Lösenord:\s*(\S+)/.exec(block)?.[1];
  if (!password) fail(`no password in the credential block:\n${block}`);
  if (!/^\d{6}$/.test(password)) fail(`password is not six digits: ${password}`);

  await shot(page, `03-ny-${role}`);
  await create.click();
  await page.getByText("Klar", { exact: false }).first().waitFor({ timeout: 20000 });
  log(`created ${role} ${name} (${email}) with password ${password}`);
  return { email, password };
}

/** Paint days on the worker's own calendar, as they would with a finger. */
async function paintDays(page, dates, mode = "Kan jobba") {
  await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: mode, exact: true }).click();
  const boxes = [];
  for (const d of dates) {
    const cell = page.locator(`[data-date="${d}"]`);
    await cell.waitFor({ timeout: 20000 });
    boxes.push(await cell.boundingBox());
  }
  const mid = (b) => [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(...mid(boxes[0]));
  await page.mouse.down();
  for (const b of boxes.slice(1)) await page.mouse.move(...mid(b), { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["Pixel 7"],           // mobile first: the design target is a phone
  locale: "sv-SE",
  timezoneId: "Europe/Stockholm",  // invariant 9
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

// Yesterday: the shift must already have ENDED for the day to be confirmable.
const yesterday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" })
  .format(new Date(Date.now() - 864e5));

console.log(`\nWalking the slice at ${BASE}\n`);

try {
  // ---- ADMIN ---------------------------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  await shot(page, "01-admin-hem");
  log("signed in as admin");

  const leader = await createPerson(page, `Lars Ledare ${RUN}`, `ledare.${RUN}@bella.test`, "arbetsledare");
  const worker = await createPerson(page, `Anna Arbetare ${RUN}`, `anna.${RUN}@bella.test`, "arbetare");

  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const projectName = `Takbyte Hörby ${RUN}`;
  await field(page, "Projektnamn").fill(projectName);
  await field(page, "Projektets adress").fill("Storgatan 12, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Takarbete och plåt");
  await field(page, "Startdatum").fill(yesterday);
  await field(page, "Arbetsledare").selectOption({ label: `Lars Ledare ${RUN}` });
  await shot(page, "04-nytt-projekt");
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  // Not /projekt/ as a regex: that also matches /projekt/ny/, so the wait
  // returned immediately and the assertion below read the form, not the list.
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  await mustSee(page, projectName, "project not listed after creation");
  await shot(page, "05-projekt-lista");
  log(`created project "${projectName}"`);

  await signOut(page);

  // ---- ARBETARE MARKS THE DAY ----------------------------------------------
  // Skapa Pass no longer picks names. The förval is the entry ticket, so the
  // worker has to say they can work the day before any tier can reach them.
  await signIn(page, worker.email, worker.password);
  await paintDays(page, [yesterday]);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(`[data-date="${yesterday}"][aria-label*="kan jobba"]`).waitFor({ timeout: 20000 });
  log(`worker marked ${yesterday} as one they can work`);
  await signOut(page);

  // ---- ARBETSLEDARE --------------------------------------------------------
  await signIn(page, leader.email, leader.password);
  await shot(page, "06-ledare-hem");
  log("signed in as arbetsledare");

  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });

  // Skapa Pass is two steps now: which days, then what each day needs.
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  const cell = page.locator(`[data-date="${yesterday}"]`);
  await cell.waitFor({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("button", { name: /Klar, / }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });

  await field(page, "Projekt").selectOption({ label: projectName });
  await page.getByLabel("Timmar på rad 1").fill("8");   // typed, not the span
  // Hand-picking is a ranking modifier, so this puts them in Tier 1 -- but only
  // because they marked the day. exact: the accessible name would otherwise
  // also match the group label.
  await page.getByRole("button", { name: `Anna Arbetare ${RUN}`, exact: true }).click();
  await shot(page, "07-skapa-pass");
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "Passen är skapade", "the pass did not generate");
  await mustSee(page, "1 av 1 platser tillsatta", "the priority list did not fill the slot");
  await shot(page, "07b-tillsatt");
  log(`created a pass on ${yesterday}, 07:00-16:00, 8 h; the tiers filled it`);

  await signOut(page);

  // ---- ARBETARE ------------------------------------------------------------
  await signIn(page, worker.email, worker.password);
  log("signed in as arbetare");

  await page.goto(`${BASE}/mina-pass/`, { waitUntil: "networkidle" });
  await mustSee(page, projectName, "the worker cannot see their own shift");
  await mustReadHours(page, "Inte bekräftat än",
    "hours were shown to the worker before the day was confirmed (invariant 10)");
  await shot(page, "08-arbetare-fore-stampling");

  await page.getByRole("button", { name: "Stämpla in" }).click();
  await page.getByRole("button", { name: "Stämpla ut" }).waitFor({ timeout: 20000 });
  log("clocked in");
  await page.getByRole("button", { name: "Stämpla ut" }).click();
  await page.getByText("Klart för dagen").waitFor({ timeout: 20000 });
  await shot(page, "09-arbetare-efter-stampling");
  log("clocked out");

  await signOut(page);

  // ---- ARBETSLEDARE CONFIRMS ----------------------------------------------
  await signIn(page, leader.email, leader.password);
  await page.goto(`${BASE}/bekrafta/`, { waitUntil: "networkidle" });

  await mustSee(page, `Anna Arbetare ${RUN}`, "the day did not reach the confirmation queue");
  await field(page, "Timmar").fill("8");
  await field(page, "Vad vi gjorde").fill("Rev gammalt tegel, la ny underlagspapp och läkt på södra takfallet.");
  await shot(page, "10-bekrafta");
  await page.getByRole("button", { name: "Bekräfta dagen" }).click();
  await page.getByText("Inget att bekräfta").waitFor({ timeout: 20000 });
  await shot(page, "11-bekraftat");
  log("confirmed the day; the queue is now empty");

  await signOut(page);

  // ---- INVARIANT 10: CONFIRMED IS NOT FILED --------------------------------
  // The day is confirmed and the hours are set. No Arbetsdagbok covers it yet,
  // so the figure can still move at stage two -- and the worker is told that,
  // rather than being left with a blank and no reason for it.
  await signIn(page, worker.email, worker.password);
  await page.goto(`${BASE}/mina-pass/`, { waitUntil: "networkidle" });
  await mustReadHours(page, "Väntar på arbetsdagbok",
    "confirmed hours were shown before the Arbetsdagbok was generated (invariant 10)");
  await shot(page, "11b-vantar-pa-arbetsdagbok");
  log("confirmed but not filed: the worker sees a status, not a number");
  await signOut(page);


  // ---- ADMIN GENERATES -----------------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`${BASE}/arbetsdagbok/`, { waitUntil: "networkidle" });
  await field(page, "Projekt").selectOption({ label: projectName });
  await field(page, "Från och med").fill(yesterday);
  await field(page, "Till och med").fill(yesterday);
  await shot(page, "12-arbetsdagbok-val");

  await page.getByRole("button", { name: "Generera Arbetsdagbok" }).click();
  await page.getByRole("button", { name: /Ladda ner PDF/ }).waitFor({ timeout: 30000 });
  await page.waitForLoadState("networkidle");
  await shot(page, "13-arbetsdagbok-forhandsvisning");
  log("generated the Arbetsdagbok");

  // Printed by Chromium's own print engine -- the same one the admin uses.
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  const out = path.join(ART, "Arbetsdagbok-shift-setter.pdf");
  writeFileSync(out, pdf);
  log(`wrote ${out} (${(pdf.length / 1024).toFixed(0)} KB)`);

  // ---- INVARIANT 10: FILED, SO THE NUMBER STOPS MOVING ---------------------
  await signOut(page);
  await signIn(page, worker.email, worker.password);
  await page.goto(`${BASE}/mina-pass/`, { waitUntil: "networkidle" });
  await mustReadHours(page, "8 h",
    "the filed hours never reached the worker (invariant 10)");
  await shot(page, "14-timmar-efter-arbetsdagbok");
  log("filed: the worker sees exactly the 8 h that went into the document");


  console.log("\nWALKTHROUGH COMPLETE -- every step produced what it should.\n");
} finally {
  await browser.close();
}
