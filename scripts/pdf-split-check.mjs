#!/usr/bin/env node
/**
 * Prove a day table TALLER THAN A PAGE splits instead of running off the sheet.
 *
 *   node scripts/pdf-split-check.mjs
 *
 * The renderer measured each day and kept it whole, which is right where a day
 * fits. Where one could not fit on any page it was still drawn as one block:
 * the rows past the bottom margin printed over the footer and then past the
 * page edge, into coordinates no reader displays. The document was not merely
 * ugly -- it was missing workers, silently, on exactly the days with the most
 * of them.
 *
 * So the assertions here are about presence first and geometry second:
 *
 *   - every seeded worker appears once per day, in the file AND on a page
 *   - nothing is drawn inside the footer band or below it
 *   - every page carrying rows carries the column labels above them
 *   - a continued day says so, rather than reading as a second entry
 *
 * A pure geometry check would pass on a document that dropped half its rows,
 * which is the failure this exists for.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pg from "pg";
import { connectionString, required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });

const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };
const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

const DAYS = 3;
const PROJEKT = "Sidbrytning (kontroll)";

/**
 * How far back the fixture's window sits. Invariant 2 says no worker holds two
 * assignments on one date, so two fixtures that both take "the first four
 * workers" over "the last few days" cannot coexist -- seeding the second one
 * raises tilldelning_one_per_worker_per_day and the check dies in its setup
 * rather than on its subject. long-doc-check reaches back twenty days, so this
 * sits well behind it AND takes only workers who are free on its own dates.
 * Either guard alone would have been enough today; both are what makes the
 * next fixture somebody adds harmless.
 */
const WINDOW_BACK = 60;

/**
 * One day's account, long enough that FOUR rows of it cannot fit on a page --
 * the column is 1.6 of 5 parts of 174mm, so this wraps to roughly twenty lines
 * and each row stands about 290pt tall against 603pt of usable page.
 *
 * Not padding for its own sake: "Vad Vi Gjorde" is free text a human types,
 * repeated down every row of that day's table, and a thorough leader writing
 * up a busy day produces exactly this.
 */
const ACCOUNT = (n) =>
  `Dag ${n}: rekonstruerad i efterhand av administratören. Rivning av innerväggar på plan två, `
  + "bortforsling av allt material till container, uppsättning av nya reglar och gipsskivor, "
  + "spackling och slipning inför målning, samt komplettering av el och ventilation i de "
  + "utrymmen som öppnades. Arbetet försenades av att leveransen av gips kom efter lunch, "
  + "varför eftermiddagen ägnades åt förberedelser i trapphuset i stället. Städning och "
  + "avetablering utfördes av hela laget innan arbetsdagens slut.";

// ---- fixture ----------------------------------------------------------------
const db = new pg.Client({
  connectionString: connectionString(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await db.connect();

const { rows: had } = await db.query(
  `select count(distinct p.work_date)::int as days
   from public.pass p
   join public.project pr on pr.id = p.project_id and pr.deleted_at is null
   where pr.name = $1 and p.deleted_at is null`, [PROJEKT]);

if (had[0].days < DAYS) {
  await db.query(`
    with admin as (
      select a.id from public.account a where a.role = 'admin' and a.active limit 1
    ),
    -- Ended days only: a day is not confirmable until its last shift is over.
    target as (
      select app.stockholm_today() - ($1::int - g) as d
      from generate_series(0, $3::int - 1) g
    ),
    -- Free on every one of those dates, ordered so a reseed picks the same
    -- four. An unordered limit picks a different four each time, and the
    -- fixture has to be the same document twice.
    hands as (
      select w.id from public.worker w
      where w.deleted_at is null
        and not exists (
          select 1 from public.tilldelning t
          where t.worker_id = w.id
            and t.work_date in (select d from target)
            and t.released_at is null
        )
      order by w.created_at, w.id
      limit 4
    ),
    proj as (
      insert into public.project (name, site_address, bestallare_address,
                                  bestallare_bolag, bestallare_orgnr, services,
                                  start_date, created_by)
      select $2, 'Brytgatan 2', 'Kundvägen 4', 'Kontroll AB', '556000-0000',
             'Kontroll', app.stockholm_today() - $1::int, (select id from admin)
      returning id
    ),
    made as (
      insert into public.pass (project_id, work_date, start_time, end_time,
                               planned_hours, headcount, created_by)
      select (select id from proj), d, '07:00', '16:00', 8.00,
             (select count(*) from hands)::smallint, (select id from admin)
      from target
      returning id, work_date
    )
    insert into public.tilldelning (pass_id, worker_id, source, work_date)
    select m.id, h.id, 'manuell', m.work_date from made m cross join hands h`,
    [WINDOW_BACK, PROJEKT, DAYS]);
  console.log(`seeded ${PROJEKT}: ${DAYS} ended days, 4 workers each`);
}

const { rows: span } = await db.query(
  `select min(p.work_date)::text as from, max(p.work_date)::text as to,
          count(distinct p.work_date)::int as days
   from public.pass p
   join public.project pr on pr.id = p.project_id and pr.deleted_at is null
   where pr.name = $1 and p.deleted_at is null`, [PROJEKT]);

/**
 * From public.worker, not worker_roster. The roster is the RLS-gated view the
 * app reads through, and this connection is the schema owner with no app role
 * behind it -- app.current_role() is NULL, every policy denies, and the view
 * hands back nothing at all. The names are the same names; only the gate
 * differs.
 */
const { rows: hands } = await db.query(
  `select distinct w.name
   from public.tilldelning t
   join public.pass p on p.id = t.pass_id and p.deleted_at is null
   join public.project pr on pr.id = p.project_id and pr.deleted_at is null
   join public.worker w on w.id = t.worker_id
   where pr.name = $1 and t.released_at is null`, [PROJEKT]);
await db.end();

const { from, to, days: dayCount } = span[0];
const NAMES = hands.map((h) => h.name).filter(Boolean);
if (NAMES.length !== 4) {
  fail(`fixture has ${NAMES.length} named workers, expected 4 -- either the roster is `
    + "too small or another fixture already holds them on these dates");
}
console.log(`documenting ${PROJEKT}, ${from}..${to} (${dayCount} days, ${NAMES.length} workers)`);

// ---- generate and download --------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  acceptDownloads: true,
});
const page = await ctx.newPage();

await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
await field(page, "E-post").fill(required("WALKTHROUGH_ADMIN_EMAIL"));
await field(page, "Lösenord").fill(required("WALKTHROUGH_ADMIN_PASSWORD"));
await page.getByRole("button", { name: "Logga in" }).click();
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });

await page.goto(`${BASE}/arbetsdagbok/`, { waitUntil: "networkidle" });
await page.locator('label:has(span:text-is("Projekt")) select option:not([value=""])')
  .first().waitFor({ state: "attached", timeout: 20000 });
await field(page, "Projekt").selectOption({ label: PROJEKT });
await field(page, "Från och med").fill(from);
await field(page, "Till och med").fill(to);
await page.getByRole("button", { name: "Generera Arbetsdagbok" }).click();

const download = page.getByRole("button", { name: /Ladda ner PDF/ });
const warning = page.getByRole("button", { name: "Ja", exact: true });

// Whichever lands first. The gaps are fetched before anything is drawn, so a
// bare count() here reads the DOM before the answer has arrived.
await Promise.race([
  download.waitFor({ timeout: 40000 }).catch(() => {}),
  warning.waitFor({ timeout: 40000 }).catch(() => {}),
]);

// Nobody confirmed these days, so the bristsurvey opens -- and closing it is
// how the document gets made, with the long account typed in as it goes.
if (await warning.count()) {
  await warning.click();
  const onward = page.getByRole("button", { name: "Bekräfta Uppgifter" });
  if (await onward.count()) await onward.click();

  const panel = page.locator('[role="dialog"]');
  const confirmDay = "Bekräfta dagen";
  for (let n = 0; n < 50 && (await panel.count()); n++) {
    const box = panel.getByRole("textbox").first();
    if (!(await box.count())) break;
    await box.fill(ACCOUNT(n + 1));
    await panel.getByRole("button", { name: confirmDay }).click();
    await page.waitForTimeout(400);
  }
  console.log("closed the range through the bristsurvey");
}

try { await download.waitFor({ timeout: 60000 }); }
catch {
  await page.screenshot({ path: path.join(ART, "FAILED-pdf-split.png"), fullPage: true });
  fail(`generation did not produce a document:\n${await page.locator("main").innerText()}`);
}

const [file] = await Promise.all([
  page.waitForEvent("download", { timeout: 40000 }),
  download.click(),
]);
const OUT = path.join(ART, file.suggestedFilename());
await file.saveAs(OUT);
await browser.close();
console.log(`downloaded: ${file.suggestedFilename()}`);

// ---- analyse ----------------------------------------------------------------
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(OUT)), useSystemFonts: false,
}).promise;

const FOOTER_WORDS = /Postadress|Telefon:|Bankgiro|F-skatt|Org\.nr|Momsreg/;
const COL_HEADS = ["Arbetare", "Pass Timmar", "Pass Tider", "Vad Vi Gjorde"];

/**
 * A band is the vertical span some marker text occupies, widened to swallow
 * anything sitting on the same lines -- the footer's address line matches no
 * marker word, so classifying by string alone reads it as body text.
 */
const bandOf = (markers, pad = 2) =>
  markers.length
    ? [Math.min(...markers.map((m) => m.y)) - pad, Math.max(...markers.map((m) => m.y + m.h)) + pad]
    : null;
const inBand = (it, band) => band && it.y + it.h > band[0] && it.y < band[1];

console.log(`\npages: ${doc.numPages}`);
const problems = [];
const seen = new Map(NAMES.map((n) => [n, 0]));
let contPages = 0;
let rowPages = 0;

for (let i = 1; i <= doc.numPages; i++) {
  const p = await doc.getPage(i);
  const items = (await p.getTextContent()).items
    .filter((it) => it.str.trim())
    .map((it) => ({ str: it.str.trim(), y: it.transform[5], h: it.height || 10 }));

  const headerBand = bandOf(items.filter((it) => /^Arbetsdagbok$/i.test(it.str)));
  const footerBand = bandOf(items.filter((it) => FOOTER_WORDS.test(it.str)));
  const body = items.filter((it) => !inBand(it, headerBand) && !inBand(it, footerBand));

  const clash = body.filter((it) => inBand(it, footerBand));
  // Anything sitting BELOW the footer is off the bottom of the sheet: in the
  // file, on no page, and therefore missing from the document.
  const under = body.filter((it) => footerBand && it.y + it.h <= footerBand[0]);

  for (const it of body) if (seen.has(it.str)) seen.set(it.str, seen.get(it.str) + 1);

  const carriesRows = body.some((it) => seen.has(it.str));
  const labelled = COL_HEADS.every((h) => body.some((it) => it.str === h));
  if (carriesRows) rowPages++;
  if (body.some((it) => /\(forts\.\)$/.test(it.str))) contPages++;

  const flags = [
    headerBand ? "" : "NO HEADER",
    footerBand ? "" : "NO FOOTER",
    clash.length ? `FOOTER OVERLAP: "${clash[0].str.slice(0, 34)}"` : "",
    under.length ? `${under.length} OFF THE SHEET: "${under[0].str.slice(0, 34)}"` : "",
    carriesRows && !labelled ? "ROWS WITH NO COLUMN LABELS" : "",
  ].filter(Boolean);

  if (flags.length) problems.push(`p${i}: ${flags.join(", ")}`);
  console.log(`  p${String(i).padStart(2)}: ${flags.length ? flags.join(", ") : "clean"}`);
}

// ---- the assertions ---------------------------------------------------------
console.log("");
for (const [name, n] of seen) {
  if (n !== dayCount) {
    problems.push(`"${name}" appears ${n} time(s) on a page, expected ${dayCount} -- one per day`);
  }
}
if (contPages === 0) {
  problems.push("no page carries a continued day -- the fixture never split, so nothing was proved");
}
if (rowPages <= dayCount) {
  problems.push(`${rowPages} page(s) carry rows for ${dayCount} day(s) -- no day spanned two pages`);
}

if (problems.length) {
  for (const p of problems) console.error(`  - ${p}`);
  fail(`${problems.length} problem(s) in ${OUT}`);
}

console.log(
  `CLEAN -- ${doc.numPages} pages, ${dayCount} day(s) split across ${rowPages} of them, `
  + `${contPages} continuation(s) marked, every worker present on every day, `
  + `nothing in or below the footer.`,
);
