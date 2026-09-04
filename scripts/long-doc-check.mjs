#!/usr/bin/env node
/**
 * Generate a long Arbetsdagbok and prove the header and footer do not collide
 * with the day tables on ANY page -- including the middle ones, which is where
 * position:fixed failed and where a two-page document proves nothing.
 *
 * The overlap test is geometric, not visual: for every page, no day-table text
 * may sit inside the vertical band the header occupies, or inside the band the
 * footer occupies. PDF y-coordinates run from the bottom of the page up.
 */
import { chromium, devices } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pg from "pg";
import { connectionString, required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/Shift-Setter";
const ART = "artifacts";
const OUT = path.join(ART, "Arbetsdagbok-lang.pdf");
mkdirSync(ART, { recursive: true });

const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };
const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

const analyseOnly = process.argv.includes("--analyse-only");

// ---- generate ---------------------------------------------------------------
if (!analyseOnly) {
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
});
const page = await ctx.newPage();

await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
await field(page, "E-post").fill(required("WALKTHROUGH_ADMIN_EMAIL"));
await field(page, "Lösenord").fill(required("WALKTHROUGH_ADMIN_PASSWORD"));
await page.getByRole("button", { name: "Logga in" }).click();
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });

/**
 * A long, ENDED range to document -- seeded here rather than hoped for.
 *
 * This used to take option index 1 over a hardcoded July-to-September window,
 * so it passed or failed on whatever data happened to be lying around: after a
 * demo reset it picked an empty project and reported a layout failure that was
 * really "there is nothing to document", and picking the biggest project
 * instead found one whose days are all in the future and therefore cannot be
 * confirmed at all. A check that can fail for a reason other than the one it is
 * named after proves nothing, so it now makes its own subject.
 *
 * The days are seeded unconfirmed on purpose. Closing them through the
 * bristsurvey is how the document gets made, which is both the case the survey
 * exists for and the longest document this repo can produce on demand.
 */
const DAYS = 20;
const PROJEKT = "Långdokument (kontroll)";

const db = new pg.Client({
  connectionString: connectionString(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await db.connect();

const { rows: existing } = await db.query(
  `select min(p.work_date)::text as from, max(p.work_date)::text as to,
          count(distinct p.work_date) as days
   from public.pass p
   join public.project pr on pr.id = p.project_id and pr.deleted_at is null
   where pr.name = $1 and p.deleted_at is null`, [PROJEKT]);

if (Number(existing[0]?.days ?? 0) < DAYS) {
  const { rowCount } = await db.query(`
    with admin as (
      select a.id from public.account a where a.role = 'admin' and a.active limit 1
    ),
    -- Four workers, so each day's table is four rows and the document runs long.
    hands as (
      select w.id, row_number() over (order by w.created_at) as n
      from public.worker w where w.deleted_at is null limit 4
    ),
    proj as (
      insert into public.project (name, site_address, bestallare_address,
                                  bestallare_bolag, bestallare_orgnr, services,
                                  start_date, created_by)
      select $2, 'Kontrollgatan 1', 'Kundvägen 4', 'Kontroll AB', '556000-0000',
             'Kontroll', app.stockholm_today() - $1::int, (select id from admin)
      returning id
    ),
    days as (
      -- Ended days only: a day is not confirmable until its last shift is over,
      -- and the survey is the thing being driven here.
      select app.stockholm_today() - g as d from generate_series($1::int, 1, -1) g
    ),
    made as (
      insert into public.pass (project_id, work_date, start_time, end_time,
                               planned_hours, headcount, created_by)
      select (select id from proj), d, '07:00', '16:00', 8.00,
             (select count(*) from hands)::smallint, (select id from admin)
      from days
      returning id, work_date
    )
    insert into public.tilldelning (pass_id, worker_id, source, work_date)
    select m.id, h.id, 'manuell', m.work_date from made m cross join hands h
    returning 1`, [DAYS, PROJEKT]);
  console.log(`seeded ${PROJEKT}: ${DAYS} ended days, ${rowCount} assignments`);
}

const { rows } = await db.query(
  `select min(p.work_date)::text as from, max(p.work_date)::text as to
   from public.pass p
   join public.project pr on pr.id = p.project_id and pr.deleted_at is null
   where pr.name = $1 and p.deleted_at is null`, [PROJEKT]);
await db.end();

const projekt = PROJEKT;
const { from, to } = rows[0];
console.log(`documenting ${projekt}, ${from}..${to}`);

await page.goto(`${BASE}/arbetsdagbok/`, { waitUntil: "networkidle" });
await page.locator('label:has(span:text-is("Projekt")) select option:not([value=""])').first().waitFor({ state: "attached", timeout: 20000 });
await field(page, "Projekt").selectOption({ label: projekt });

await field(page, "Från och med").fill(from);
await field(page, "Till och med").fill(to);
await page.getByRole("button", { name: "Generera Arbetsdagbok" }).click();

/**
 * Nobody confirmed these days, so the bristsurvey opens -- and closing it is
 * how the document gets made. Driving it here is not a detour: a long document
 * reconstructed by the owner is exactly the case the survey exists for, and it
 * is also the longest one this repo can produce on demand.
 */
const download = page.getByRole("button", { name: /Ladda ner PDF/ });
const warning = page.getByRole("button", { name: "Ja", exact: true });

// Whichever lands first. The gaps are fetched before anything is drawn, so a
// bare count() here reads the DOM before the answer has arrived and walks past
// a survey that is about to open.
await Promise.race([
  download.waitFor({ timeout: 40000 }).catch(() => {}),
  warning.waitFor({ timeout: 40000 }).catch(() => {}),
]);

if (await warning.count()) {
  await warning.click();
  const onward = page.getByRole("button", { name: "Bekräfta Uppgifter" });
  if (await onward.count()) await onward.click();

  // Scoped to the panel, and driven off the panel's own presence. Counting on
  // the download button instead ran one extra lap: the last day closes, the
  // document is still being built, and the "textbox" the loop then grabbed was
  // the date picker underneath.
  const panel = page.locator('[role="dialog"]');
  for (let n = 0; n < 200 && (await panel.count()); n++) {
    const box = panel.getByRole("textbox").first();
    if (!(await box.count())) break;
    await box.fill(`Dag ${n + 1}: rekonstruerad i efterhand av administratören.`);
    await panel.getByRole("button", { name: "Bekräfta dagen" }).click();
    await page.waitForTimeout(400);
  }
  console.log("closed the range through the bristsurvey");
}

try {
  await download.waitFor({ timeout: 60000 });
} catch {
  const main = await page.locator("main").innerText().catch(() => "(no main)");
  await page.screenshot({ path: path.join(ART, "FAILED-long-doc.png"), fullPage: true });
  fail(`generation did not produce a document.
--- screen ---
${main}`);
}
await page.waitForLoadState("networkidle");
await page.emulateMedia({ media: "print" });
writeFileSync(OUT, await page.pdf({
  format: "A4", printBackground: true,
  margin: { top: "0", right: "0", bottom: "0", left: "0" },
}));
await browser.close();
console.log(`wrote ${OUT}`);
}

// ---- analyse ----------------------------------------------------------------
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(OUT)), useSystemFonts: false,
}).promise;

const FOOTER_WORDS = /Postadress|Telefon:|Bankgiro|F-skatt|Org\.nr|Momsreg/;

console.log(`
pages: ${doc.numPages}`);
if (doc.numPages < 4) fail(`only ${doc.numPages} pages -- not long enough to have middle pages`);

/**
 * A band is the vertical span some marker text occupies, widened to swallow
 * anything sitting on the same lines. Classifying by string alone was wrong:
 * the footer's address line matches no marker word, so it read as body text
 * below the footer and every page reported a false overlap.
 */
const bandOf = (markers, pad = 2) =>
  markers.length
    ? [Math.min(...markers.map((m) => m.y)) - pad, Math.max(...markers.map((m) => m.y + m.h)) + pad]
    : null;

const inBand = (it, band) => band && it.y + it.h > band[0] && it.y < band[1];

let bad = 0;
for (let i = 1; i <= doc.numPages; i++) {
  const p = await doc.getPage(i);
  const items = (await p.getTextContent()).items
    .filter((it) => it.str.trim())
    .map((it) => ({ str: it.str.trim(), y: it.transform[5], h: it.height || 10 }));

  const headerBand = bandOf(items.filter((it) => /^Arbetsdagbok$/i.test(it.str)));
  const footerBand = bandOf(items.filter((it) => FOOTER_WORDS.test(it.str)));

  // Everything not sitting on the header's or the footer's own lines.
  const body = items.filter((it) => !inBand(it, headerBand) && !inBand(it, footerBand));

  const headerClash = body.filter((it) => inBand(it, headerBand));
  const footerClash = body.filter((it) => inBand(it, footerBand));

  const flags = [
    headerBand ? "header" : "NO HEADER",
    footerBand ? "footer" : "NO FOOTER",
    headerClash.length ? `HEADER OVERLAPS: ${headerClash[0].str}` : "",
    footerClash.length ? `FOOTER OVERLAPS: ${footerClash[0].str}` : "",
  ].filter(Boolean);

  // How much clear air is left between the last body line and the footer.
  const gap = footerBand && body.length
    ? (Math.min(...body.map((b) => b.y)) - footerBand[1]).toFixed(1)
    : "-";

  if (!headerBand || !footerBand || headerClash.length || footerClash.length) bad++;
  console.log(`  p${String(i).padStart(2)}: ${flags.join(", ")}   (gap above footer: ${gap}pt)`);
}

console.log(
  bad === 0
    ? `
CLEAN -- header and footer on all ${doc.numPages} pages, neither overlapping the tables on any page.`
    : `
${bad} page(s) FAILED`,
);
process.exit(bad === 0 ? 0 : 1);
