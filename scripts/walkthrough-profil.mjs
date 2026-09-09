#!/usr/bin/env node
/**
 * Drive the Profil form: every field, the company toggle, save and persist --
 * and the case the form is easiest to get wrong, an admin editing SOMEBODY
 * ELSE'S profile.
 *
 * That last one is the point of the run. The screen takes its subject from
 * ?id=, and a save that reached for the signed-in user's id instead would
 * quietly write the admin's own row while showing another person's name at the
 * top. Nothing on screen would look wrong. So the admin edits the worker, and
 * then the admin's OWN profile is re-read and must not have moved.
 *
 * Values carry a per-run stamp. A form that saved nothing would otherwise pass
 * on what the previous run left behind.
 *
 *   BASE_URL=https://tabxzzxtab.github.io/Shift-Setter node scripts/walkthrough-profil.mjs
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/Shift-Setter";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };
const shot = (page, n) => page.screenshot({ path: path.join(ART, `${n}.png`), fullPage: true });

/** Field and Check both render <label><span>LABEL</span>…</label>. */
const boxes = (page, label) =>
  page.locator(`label:has(> span:text-is("${label}"))`).locator("input, textarea");
const field = (page, label, i = 0) => boxes(page, label).nth(i);
// The handoff draws its own 26px box, so these are role="checkbox" buttons
// rather than native inputs. Asked for by ROLE, which is the thing that has to
// be right: a drawn control that does not announce itself as a checkbox is the
// failure, and getByRole is the only locator that would notice.
const check = (page, label) => page.getByRole("checkbox", { name: label, exact: true });

async function mustSee(page, text, why) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 20000 });
  } catch {
    await shot(page, "FAILED");
    fail(`${why} (never saw "${text}"; see artifacts/FAILED.png)`);
  }
}

const landed = (page) =>
  page.getByRole("button", { name: "Profil", exact: true }).waitFor({ timeout: 30000 });

async function signIn(ctx, email, password) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail(`page error: ${e.message}`));
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await page.locator("form").waitFor({ timeout: 20000 });
  await field(page, "E-post").fill(email);
  await field(page, "Lösenord").fill(password);
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
  await landed(page);
  return page;
}

const stamp = String(Date.now()).slice(-6);

// The eight that are always asked for, and the value each must come back as.
//
// READ BY POSITION, like the company block below. The handoff puts these in
// three titled cards and shortens the labels to suit -- "Närmast anhörig
// telefonnummer" is "Telefonnummer" under a card that already says whose --
// so a label is no longer unique on the page and the index says which card.
const ALWAYS = [
  ["Telefonnummer", 0, `070-000 ${stamp}`],
  ["Adress", 0, `Provgatan ${stamp}`],
  ["Postnr", 0, `24${stamp.slice(0, 3)}`],
  ["Stad", 0, `Hörby ${stamp}`],
  ["Clearing", 0, `8${stamp.slice(0, 3)}`],
  ["Kontonummer", 0, `${stamp}0001`],
  ["Namn", 0, `Anhörig ${stamp}`],
  ["Telefonnummer", 1, `073-111 ${stamp}`],
];

// The nine behind the toggle. Stad still repeats, so it is read by position:
// the personal one is first on the page, the company one second. Postnummer no
// longer repeats -- the handoff calls the personal one "Postnr" -- so the
// company field is the only one under that name and sits at 0.
const COMPANY = [
  ["Företagsnamn", 0, `Bolaget ${stamp} AB`],
  ["Organisationsnummer", 0, `5567-${stamp}`],
  ["Fakturaadress", 0, `Fakturagatan ${stamp}`],
  ["Postnummer", 0, `39${stamp.slice(0, 3)}`],
  ["Stad", 1, `Eslöv ${stamp}`],
  ["Län", 0, `Skåne ${stamp}`],
  ["Bankgiro/Plusgiro", 0, `443-${stamp}`],
  ["Momsregistreringsnummer", 0, `SE${stamp}01`],
];

const browser = await chromium.launch();
console.log(`\nProfil form at ${BASE}   (run stamp ${stamp})\n`);

try {
  // ==========================================================================
  // THE WORKER FILLS IN WHAT IS MISSING
  // ==========================================================================
  const wctx = await browser.newContext({
    ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  });
  const w = await signIn(wctx, required("DEMO_WORKER_EMAIL"), required("DEMO_WORKER_PASSWORD"));
  log("signed in as the arbetare");

  await w.getByRole("button", { name: "Profil", exact: true }).click();
  const pop = w.getByRole("dialog", { name: "Profil" });
  await pop.waitFor({ timeout: 20000 });
  await pop.getByRole("link", { name: "Profil", exact: true }).click();
  await w.waitForURL((u) => u.pathname.includes("/profil"), { timeout: 20000 });
  await mustSee(w, "Har du företag?", "the Profil form never rendered");
  log("reached Profil from the profile icon");

  // Namn and e-post are locked: not shown as fields at all, and said so.
  //
  // SCOPED TO THE KONTAKT CARD. "Namn" is a legitimate field further down --
  // the next of kin's, under a card that says so -- so an unscoped check would
  // now fail on a screen that is correct, and dropping it would stop testing
  // the thing it exists for. The worker's own name would live in Kontakt.
  const kontakt = w.locator('[data-card="Kontakt"]');
  await kontakt.waitFor({ timeout: 20000 });
  for (const locked of ["Namn", "E-post"]) {
    if (await kontakt.locator(`label:has(> span:text-is("${locked}"))`).count()) {
      await shot(w, "FAILED");
      fail(`"${locked}" is editable on the arbetare's own Profil; it must be locked`);
    }
  }
  if (await boxes(w, "E-post").count()) {
    await shot(w, "FAILED");
    fail("an E-post field exists somewhere on the arbetare's own Profil");
  }
  if (await w.locator('[data-card="Närmast anhörig"] label:has(> span:text-is("Namn"))').count() !== 1) {
    fail("the one Namn field on the page is not the next of kin's");
  }
  await mustSee(w, "Namn och e-post ändras av administratören",
                "nothing tells the arbetare why namn and e-post are absent");
  log("namn and e-post are locked, and the screen says who changes them");

  // The company block stays shut until asked for.
  if (await boxes(w, "Organisationsnummer").count()) {
    fail("the company fields are on screen before the toggle is switched on");
  }
  log("the company fields are hidden until the toggle is on");

  for (const [label, i, value] of ALWAYS) {
    const box = field(w, label, i);
    if (!(await box.count())) fail(`the form has no "${label}" field (position ${i})`);
    await box.fill(value);
  }
  log(`filled all ${ALWAYS.length} always-visible fields`);

  await check(w, "Har du företag?").check();
  await w.locator(`label:has(> span:text-is("Organisationsnummer"))`)
    .waitFor({ timeout: 10000 });
  for (const [label, i, value] of COMPANY) {
    const box = field(w, label, i);
    if (!(await box.count())) fail(`the company block has no "${label}" field`);
    await box.fill(value);
  }
  await check(w, "F-skatt").check();
  await shot(w, "p1-ifylld");
  log(`toggle revealed the company block; filled ${COMPANY.length} fields and F-skatt`);

  await w.getByRole("button", { name: "Spara", exact: true }).click();
  await mustSee(w, "Sparat.", "saving the profile reported nothing");
  log("Spara reported Sparat.");

  // The real test of a save: come back and find it there.
  await w.reload({ waitUntil: "networkidle" });
  await mustSee(w, "Har du företag?", "the form did not come back after a reload");
  for (const [label, i, value] of ALWAYS) {
    const got = await field(w, label, i).inputValue();
    if (got !== value) fail(`after reload "${label}" (position ${i}) reads ${JSON.stringify(got)}, wanted ${JSON.stringify(value)}`);
  }
  if (!(await check(w, "Har du företag?").isChecked())) {
    fail("the company toggle did not survive the reload");
  }
  for (const [label, i, value] of COMPANY) {
    const got = await field(w, label, i).inputValue();
    if (got !== value) fail(`after reload company "${label}" reads ${JSON.stringify(got)}, wanted ${JSON.stringify(value)}`);
  }
  if (!(await check(w, "F-skatt").isChecked())) fail("F-skatt did not survive the reload");
  await shot(w, "p2-sparad");
  log("every field, the toggle and F-skatt survived a reload");

  // ==========================================================================
  // THE ADMIN EDITS SOMEBODY ELSE
  // ==========================================================================
  const actx = await browser.newContext({
    ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  });
  const a = await signIn(actx, required("WALKTHROUGH_ADMIN_EMAIL"),
                         required("WALKTHROUGH_ADMIN_PASSWORD"));
  log("signed in as the admin in a second browser");

  await a.getByRole("button", { name: "Meny", exact: true }).click();
  await a.getByRole("link", { name: "Inställningar", exact: true }).click();
  await a.waitForURL((u) => u.pathname.includes("/installningar"), { timeout: 20000 });

  const email = required("DEMO_WORKER_EMAIL");
  const row = a.locator("section[data-konto]").filter({ hasText: email }).first();
  await row.waitFor({ timeout: 20000 });
  await row.getByText("Ändra profil", { exact: true }).click();
  await a.waitForURL((u) => u.pathname.includes("/profil"), { timeout: 20000 });

  const url = new URL(a.url());
  if (!url.searchParams.get("id")) {
    fail(`Ändra profil did not put the account in scope: ${a.url()}`);
  }
  await mustSee(a, "Du ändrar profilen för", "nothing says whose profile the admin is editing");
  log(`admin opened the arbetare's profile with id=${url.searchParams.get("id").slice(0, 8)}…`);

  // The admin sees what the worker saved, which is already proof the id in
  // scope is being READ rather than the signed-in user's.
  const seen = await field(a, "Stad").inputValue();
  if (seen !== `Hörby ${stamp}`) {
    fail(`the admin is not looking at the arbetare's row: Stad reads ${JSON.stringify(seen)}`);
  }
  log("the admin is reading the arbetare's values, not their own");

  const ADMIN_EDIT = `Lund ${stamp}`;
  await field(a, "Stad").fill(ADMIN_EDIT);
  await a.getByRole("button", { name: "Spara", exact: true }).click();
  await mustSee(a, "Sparat.", "the admin's save reported nothing");
  await shot(a, "p3-admin-annans-profil");
  log("admin changed a field on the arbetare's profile and saved");

  // AND THE WHOLE POINT: the admin's own row must not have moved.
  await a.goto(`${BASE}/profil/`, { waitUntil: "networkidle" });
  await mustSee(a, "Har du företag?", "the admin's own Profil did not load");
  const own = await field(a, "Stad").inputValue();
  if (own === ADMIN_EDIT || own === `Hörby ${stamp}`) {
    await shot(a, "FAILED");
    fail(`the admin's save landed on their OWN profile: Stad reads ${JSON.stringify(own)}`);
  }
  await shot(a, "p4-admin-egen-profil");
  log(`the admin's own profile is untouched (Stad reads ${JSON.stringify(own)})`);

  // And the change reached the worker, who sees it on next load.
  await w.reload({ waitUntil: "networkidle" });
  await mustSee(w, "Har du företag?", "the arbetare's form did not reload");
  const back = await field(w, "Stad").inputValue();
  if (back !== ADMIN_EDIT) {
    fail(`the admin's edit never reached the arbetare: Stad reads ${JSON.stringify(back)}`);
  }
  log("the arbetare sees the admin's edit on their own profile");

  console.log("\nPROFIL FORM COMPLETE.\n");
} finally {
  await browser.close();
}
