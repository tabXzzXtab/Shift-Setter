#!/usr/bin/env node
/**
 * Företaget -- the company's own details, and the document they print on.
 *
 * WHAT IT PROVES, in the order it matters:
 *
 *   the values SAVE and survive a reload;
 *   they REACH THE ARBETSDAGBOK, which is the only reason the screen exists --
 *     the footer used to be a constant holding Bella Service AB's address and
 *     telephone, so every other company's document carried their identity;
 *   invariant 6 REFUSES generation without adress, kontaktperson or telefon;
 *   the LOGO is the one that may be blank, and the company name stands in its
 *     place -- a test that only checked the refusals would pass against a
 *     screen that demanded everything;
 *   an arbetsledare gets a READ-ONLY form, and the database agrees.
 *
 * THIS IS THE ONLY FIXTURE THAT EDITS A ROW IT DOES NOT OWN. Every other
 * walkthrough creates its people and its projects and leaves them behind;
 * tenant_branding is one row per COMPANY, and the company here is the live
 * one. demo:reset does not put it back -- it clears projects, passes, workers
 * and accounts and leaves every tenancy standing -- so this run reads the four
 * values first and restores them in a finally block.
 *
 * It does not make its own tenancy to play in, which would be the obvious way
 * out: nothing deletes a tenancy (CLAUDE.md), so every run would leave one
 * behind for good.
 *
 *   BASE_URL=https://app.bellaserviceab.se node scripts/walkthrough-foretag.mjs
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { connectionString, required } from "./env.mjs";
import { reachDate, shiftDays, stockholmToday } from "./wt-dates.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
/**
 * FAILING MUST NOT SKIP THE RESTORE.
 *
 * Every other walkthrough ends a failure with process.exit(1), which is fine
 * when the run owns everything it wrote. This one edits the company's own row,
 * and process.exit does not run finally blocks -- so the first failing run left
 * Bella Service AB carrying a test address, a test contact and a test
 * telephone, with null where its bankgiro and momsreg had been. The restore
 * was written, correct, and never given the chance to run.
 *
 * So failing throws, the finally puts the company back, and the exit code is
 * set rather than taken.
 */
class Failed extends Error {}
const fail = (m) => { throw new Failed(m); };
const shot = (page, n) => page.screenshot({ path: path.join(ART, `${n}.png`), fullPage: true });

// select is in the list because Roll is a dropdown: a helper that only knows
// about inputs waits thirty seconds and then reports a missing field rather
// than a field of a kind it cannot see.
const boxes = (page, label) =>
  page.locator(`label:has(> span:text-is("${label}"))`).locator("input, textarea, select");
const field = (page, label, i = 0) => boxes(page, label).nth(i);

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
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
}

/**
 * Make an arbetsledare to look at the screen with.
 *
 * ITS OWN, RATHER THAN THE DEMO ONE. This reached for DEMO_LEADER_EMAIL first
 * and failed to sign in, because ledare@bellaservice.se was gone: somebody had
 * run supabase/maintenance/reset-demo-data.sql directly instead of
 * `npm run demo:reset`, and the raw file deletes the non-admin accounts
 * without the step that puts the stable ones back. CLAUDE.md warns about
 * exactly that. A fixture that depends on those accounts existing is a fixture
 * that fails for a reason having nothing to do with what it tests.
 */
async function createPerson(page, name, email, role) {
  await page.goto(`${BASE}/arbetare/ny/`, { waitUntil: "networkidle" });
  await field(page, "Namn").fill(name);
  await field(page, "E-post").fill(email);
  await field(page, "Roll").selectOption(role);
  await page.getByRole("button", { name: /Kopiera inloggning/ }).click();
  const password = (await page.locator("[data-password]").first().innerText()).trim();
  if (!password) fail(`no password was shown for ${name}`);
  await page.getByRole("button", { name: "Tillverka arbetare" }).click();
  await page.getByText("Klar", { exact: false }).first().waitFor({ timeout: 30000 });
  return { name, email, password };
}

/** Tap a day on the availability calendar, which is the entry ticket a tier needs. */
async function markDay(page, date) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
    await reachDate(page, date, fail);
    await page.waitForTimeout(800);
    if (await page.locator(`[data-date="${date}"][aria-label*="kan jobba"]`).count()) return;
    await page.getByRole("button", { name: "Kan jobba", exact: true }).click();
    const cell = page.locator(`[data-date="${date}"]`);
    await cell.scrollIntoViewIfNeeded();
    const b = await cell.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(2000);
  }
  await shot(page, "FAILED");
  fail(`could not mark ${date} as a day ${date} can be worked`);
}

async function signOut(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  await page.getByRole("button", { name: /Logga ut/ }).click();
  await page.waitForURL((u) => u.pathname.includes("/login"), { timeout: 30000 });
}

const RUN = String(Date.now()).slice(-6);
/** A day already over: only an ended day reaches the confirmation queue. */
const YESTERDAY = shiftDays(stockholmToday(), -1);
const ADDRESS = `Provgatan ${RUN}, 242 93 Hörby`;
const CONTACT = `Kontakt ${RUN}`;
const PHONE = `070-000 ${RUN}`;

/**
 * A small PNG, built rather than pasted.
 *
 * BUILT BECAUSE A PASTED ONE WAS WRONG. The first version of this was a base64
 * literal I checked by its signature and its IEND marker, both of which were
 * fine while the pixel data was not -- so the upload failed in the browser with
 * "The source image could not be decoded" and the run reported it as the
 * screen's fault. A fixture that is almost a PNG is worse than no fixture: it
 * fails somewhere else and blames something else.
 *
 * Assembled here from real chunks, so it is valid by construction and there is
 * no binary in the repository for this one test.
 */
function tinyPng(w = 8, h = 8) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // 8 bits per channel
  ihdr[9] = 2;   // truecolour RGB
  // 10..12 are compression, filter and interlace, all zero and all default.

  // One filter byte per row, then w pixels of solid blue -- visible in the
  // screenshot, which a transparent pixel would not be.
  const raw = Buffer.concat(Array.from({ length: h }, () =>
    Buffer.concat([Buffer.from([0]), Buffer.concat(
      Array.from({ length: w }, () => Buffer.from([0x1b, 0x2c, 0xc1])))])));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A signed-in client, for the bucket only.
 *
 * pg reaches the row and Playwright reaches the screen, and neither can carry
 * the logo's bytes out and back again. Signed in as the same admin the run
 * drives, so the storage policies apply to it exactly as they do to the page --
 * a service key would restore the file while proving nothing about whether an
 * admin could.
 */
const sbAdmin = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"), required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  { auth: { persistSession: false } });
{
  const { error } = await sbAdmin.auth.signInWithPassword({
    email: required("WALKTHROUGH_ADMIN_EMAIL"),
    password: required("WALKTHROUGH_ADMIN_PASSWORD"),
  });
  if (error) fail(`could not sign the storage client in: ${error.message}`);
}

const db = new pg.Client({
  connectionString: connectionString(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await db.connect();

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

console.log(`\nFöretaget at ${BASE}\n`);

/**
 * A SIGNAL MUST NOT SKIP THE RESTORE EITHER.
 *
 * process.exit() was the first way the finally got bypassed and throwing fixed
 * it. `timeout 420 npm run ...` is the second: SIGTERM ends the process without
 * unwinding, so a run that took too long left the company carrying a test
 * address, and every later run then faithfully "restored" the corruption it
 * found at ITS start. That is how one skipped restore becomes permanent.
 *
 * These handlers close the ordinary cases. They do not close SIGKILL or the
 * power going out, and nothing in-process can -- which is worth knowing about
 * the only fixture here that edits a row it does not own.
 */
/** Read before anything is touched, put back in the finally. */
let original = null;
let tenantId = null;
/**
 * The company's real logo, bytes and all.
 *
 * THE ROW IS NOT ENOUGH. Restoring logo_path puts the pointer back and leaves
 * this run's test image sitting at the other end of it -- so the company keeps
 * its record and loses its logo, which is the worse half to lose and the
 * quieter one. The file has one name per tenancy, so uploading here overwrites
 * the real one rather than sitting beside it.
 */
let originalLogo = null;
let restored = false;

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    void (async () => {
      await restoreCompany().catch((e) => console.error(`  !! restore failed: ${e.message}`));
      await browser.close().catch(() => {});
      await db.end().catch(() => {});
      process.exit(1);
    })();
  });
}

try {
  // ---- what the company looks like before this run ---------------------------
  const before = await db.query(
    `select b.tenant_id, b.logo_path, b.address, b.contact_name, b.phone,
            b.bankgiro, b.momsreg_nr
       from public.tenant_branding b
       join public.tenant t on t.id = b.tenant_id
      where t.org_nr = '556788-2369'`);
  if (before.rowCount !== 1) {
    fail(`expected one branding row for the demo company, found ${before.rowCount}`);
  }
  original = before.rows[0];
  tenantId = original.tenant_id;
  if (original.logo_path) {
    const dl = await sbAdmin.storage.from("branding").download(original.logo_path);
    if (dl.error) fail(`could not read the company's logo to put it back: ${dl.error.message}`);
    originalLogo = Buffer.from(await dl.data.arrayBuffer());
  }
  log(`read the company's details and ${originalLogo ? `${originalLogo.length} bytes of logo` : "no logo"}, to be restored at the end`);

  // ---- the screen is behind the profile icon, not the hamburger --------------
  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));
  const LEADER = await createPerson(page, `Ledare F${RUN}`, `ledare.f${RUN}@bella.test`, "arbetsledare");
  const WORKER = await createPerson(page, `Arbetare F${RUN}`, `arbetare.f${RUN}@bella.test`, "arbetare");
  log(`created ${LEADER.name} and ${WORKER.name}`);

  // ---- a day the Arbetsdagbok can actually be made from ----------------------
  //
  // BUILT RATHER THAN BORROWED. The document check below is the only assertion
  // that proves these values reach the deliverable, which is the entire reason
  // the screen exists -- and it needs a confirmed day to generate from. It used
  // to take whatever the database happened to hold and skip when there was
  // none, which on a freshly reset database is always: the run went green
  // having tested the form and nothing else. A check that silently does not run
  // is worse than one that is missing, because the green says otherwise.
  //
  // So the run makes its own: a project, a day already over, a worker who said
  // they could work it, and the leader's confirmation. Yesterday because a day
  // has to have ENDED before it reaches the confirmation queue.
  const PROJECT = `Företagsprojektet ${RUN}`;
  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  await field(page, "Projektnamn").fill(PROJECT);
  await field(page, "Projektets adress").fill(`Storgatan ${RUN}, 242 30 Hörby`);
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Takarbete och plåt");
  await field(page, "Startdatum").fill(YESTERDAY);
  await field(page, "Arbetsledare").selectOption({ label: LEADER.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  await signOut(page);

  // The förval is the entry ticket: no tier can reach somebody who has not said
  // they can work the day.
  await signIn(page, WORKER.email, WORKER.password);
  await markDay(page, YESTERDAY);
  await signOut(page);

  await signIn(page, LEADER.email, LEADER.password);
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Välj dagar" }).waitFor({ timeout: 20000 });
  await reachDate(page, YESTERDAY, fail);
  {
    const cell = page.locator(`[data-date="${YESTERDAY}"]`);
    await cell.scrollIntoViewIfNeeded();
    const b = await cell.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  }
  await page.getByRole("button", { name: "Fortsätt", exact: true }).click();
  await page.getByRole("heading", { name: "Beskriv passen" }).waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: PROJECT });
  await page.getByLabel("Timmar på rad 1").fill("8");
  await page.getByRole("button", { name: WORKER.name, exact: true }).click();
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "Passen är skapade", "the fixture pass was not created");

  await page.goto(`${BASE}/bekrafta/`, { waitUntil: "networkidle" });
  await mustSee(page, WORKER.name, "the fixture day did not reach the confirmation queue");
  await field(page, "Timmar").fill("8");
  await page.getByLabel("Vad vi gjorde").fill(`Provarbete ${RUN} på taket.`);
  await page.getByRole("button", { name: "Bekräfta dagen" }).click();
  await mustSee(page, "Inget att bekräfta", "the fixture day was not confirmed");
  await signOut(page);
  log(`built a confirmed day on ${YESTERDAY} for "${PROJECT}" to generate from`);

  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  const entry = page.getByRole("link", { name: "Företaget", exact: true });
  if (!(await entry.count())) {
    await shot(page, "FAILED");
    fail("Företaget is not in the profile sheet");
  }
  await entry.click();
  await page.waitForURL((u) => u.pathname.includes("/foretag"), { timeout: 20000 });
  log("Företaget opens from the profile sheet");

  // ---- the three the document demands ---------------------------------------
  await field(page, "Adress").fill(ADDRESS);
  await field(page, "Kontaktperson").fill(CONTACT);
  await field(page, "Telefonnummer").fill(PHONE);
  await page.getByRole("button", { name: "Spara", exact: true }).click();
  await mustSee(page, "Företagets uppgifter är sparade", "the save reported nothing");
  await shot(page, "ft1-sparad");
  log("filled adress, kontaktperson and telefon, and saved");

  // Reloaded rather than trusted: a form that wrote nothing would still be
  // showing what was typed into it.
  await page.reload({ waitUntil: "networkidle" });
  const back = await field(page, "Adress").inputValue();
  if (back !== ADDRESS) fail(`after a reload Adress reads ${JSON.stringify(back)}`);
  log("they survive a reload -- the row was written, not the form");

  // ---- the logo ---------------------------------------------------------------
  const logoFile = path.join(ART, `foretag-logo-${RUN}.png`);
  writeFileSync(logoFile, tinyPng());
  await page.locator('input[aria-label="Välj logotyp"]').setInputFiles(logoFile);
  await mustSee(page, "Logotypen är sparad", "the logo upload reported nothing");
  await page.reload({ waitUntil: "networkidle" });
  if (await page.locator('[data-logo-slot="image"]').count() !== 1) {
    await shot(page, "FAILED");
    fail("after uploading, the logo slot is not showing an image");
  }
  // The path the storage policy admits, and the only two it admits.
  const stored = await db.query(
    "select logo_path from public.tenant_branding where tenant_id = $1", [tenantId]);
  const p = stored.rows[0].logo_path;
  if (p !== `${tenantId}/logo.png` && p !== `${tenantId}/logo.jpg`) {
    fail(`logo_path is ${JSON.stringify(p)}, which the storage policy would refuse`);
  }
  log(`logo uploaded and recorded as ${p.split("/")[1]}`);

  // ---- it reaches the Arbetsdagbok -------------------------------------------
  //
  // THE ASSERTION THE SCREEN EXISTS FOR. Everything above proves a form saves;
  // only this proves the saved values print on the deliverable, which is the
  // bug the whole feature closes -- every company's document carried Bella
  // Service AB's address and telephone until tenant_branding.
  //
  // The day is the one this run built, looked up rather than remembered so the
  // lookup also proves it was confirmed. Finding none is now a failure, not a
  // skip: the fixture above guarantees one, so its absence means the fixture
  // broke and the check that matters would otherwise pass by not running.
  const day = await db.query(
    `select pr.name, pd.work_date::text as d
       from public.project_day pd
       join public.project pr on pr.id = pd.project_id
      where pd.stage in ('leader_confirmed','admin_confirmed')
        and pr.deleted_at is null and pr.tenant_id = $1 and pr.name = $2`,
    [tenantId, PROJECT]);
  if (day.rowCount !== 1) {
    fail(`expected the run's own confirmed day for "${PROJECT}", found ${day.rowCount}`);
  }

  const { name, d } = day.rows[0];
  await page.goto(`${BASE}/arbetsdagbok/`, { waitUntil: "networkidle" });
  await field(page, "Projekt").selectOption({ label: name });
  await field(page, "Från och med").fill(d);
  await field(page, "Till och med").fill(d);
  await page.getByRole("button", { name: "Generera Arbetsdagbok" }).click();
  await page.getByRole("button", { name: /Ladda ner PDF/ }).waitFor({ timeout: 30000 });
  // The run stamp is what only this run could have put there. "Adress" alone
  // would match the label, the old constant, and anything else on the page.
  await mustSee(page, ADDRESS, "the document footer does not carry this company's address");
  await mustSee(page, CONTACT, "the document footer does not carry this company's contact");
  await mustSee(page, PHONE, "the document footer does not carry this company's telephone");
  await shot(page, "ft2-dokumentet");
  log("the document's footer carries this run's address, contact and telephone");

  // ---- invariant 6, extended to the footer ------------------------------------
  await page.goto(`${BASE}/foretag/`, { waitUntil: "networkidle" });
  await field(page, "Adress").fill("");
  await page.getByRole("button", { name: "Spara", exact: true }).click();
  await mustSee(page, "Arbetsdagboken kan inte skapas än",
                "an empty adress is not reported as blocking the document");
  await shot(page, "ft3-saknas");
  log("with adress blank the screen says the document cannot be made");

  const blocked = await db.query(
    "select address from public.tenant_branding where tenant_id = $1", [tenantId]);
  if (blocked.rows[0].address !== null) {
    fail(`a blank adress was stored as ${JSON.stringify(blocked.rows[0].address)}, not null`);
  }
  log("and the blank went to the database as null, which the CHECK requires");

  // ---- the logo is the one that may be blank ---------------------------------
  //
  // Without this, everything above would pass against a screen that simply
  // demanded all five fields -- and a company with no logo could not use the
  // product at all.
  await field(page, "Adress").fill(ADDRESS);
  await page.getByRole("button", { name: "Spara", exact: true }).click();
  await mustSee(page, "Företagets uppgifter är sparade", "putting adress back failed");
  await page.getByRole("button", { name: "Ta bort", exact: true }).click();
  await mustSee(page, "Företagets namn står i dess ställe", "removing the logo said nothing");
  await page.reload({ waitUntil: "networkidle" });
  if (await page.locator('[data-logo-slot="name"]').count() !== 1) {
    await shot(page, "FAILED");
    fail("with no logo the slot does not fall back to the company name");
  }
  log("no logo is allowed, and the company's name stands in its place");

  // ---- an arbetsledare may look and not touch --------------------------------
  await signOut(page);
  await signIn(page, LEADER.email, LEADER.password);
  await page.goto(`${BASE}/foretag/`, { waitUntil: "networkidle" });
  await mustSee(page, "ändras av administratören", "a leader is not told who changes these");
  if (await page.getByRole("button", { name: "Spara", exact: true }).count()) {
    fail("a leader is offered a Spara button");
  }
  log("an arbetsledare sees the details and no way to change them");

  // THE DATABASE HALF IS NOT ASSERTED HERE. What a leader may actually write
  // is a policy question, and policy questions belong in supabase/tests/
  // suite.sql where they can be disabled one at a time and the suite made to
  // fail on purpose. A browser cannot prove a boundary it is on the wrong side
  // of: if the screen lied, this run would pass and the assertion would mean
  // nothing. The read-only form above is a courtesy, tested as a courtesy.

  await signOut(page);
  console.log("\nFÖRETAGET WALKTHROUGH COMPLETE.\n");
} catch (e) {
  if (e instanceof Failed) console.error(`\nFAILED: ${e.message}`);
  else console.error(e);
  process.exitCode = 1;
} finally {
  await restoreCompany();
  await browser.close().catch(() => {});
  await db.end().catch(() => {});
}

/** Idempotent: the handlers and the finally may both reach it. */
async function restoreCompany() {
  if (restored) return;
  restored = true;
  if (original && tenantId) {
    await db.query(
      `update public.tenant_branding
          set address = $2, contact_name = $3, phone = $4,
              bankgiro = $5, momsreg_nr = $6, logo_path = $7
        where tenant_id = $1`,
      [tenantId, original.address, original.contact_name, original.phone,
       original.bankgiro, original.momsreg_nr, original.logo_path]);
    if (originalLogo) {
      const up = await sbAdmin.storage.from("branding")
        .upload(original.logo_path, originalLogo,
                { contentType: original.logo_path.endsWith(".jpg") ? "image/jpeg" : "image/png",
                  upsert: true });
      if (up.error) console.error(`  !! the logo could NOT be put back: ${up.error.message}`);
    }
    console.log(`  -- the company's original details${originalLogo ? " and logo" : ""} were restored`);
  }
}
