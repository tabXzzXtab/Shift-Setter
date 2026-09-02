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
import { required } from "./env.mjs";

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

await page.goto(`${BASE}/arbetsdagbok/`, { waitUntil: "networkidle" });
await page.locator('label:has(span:text-is("Projekt")) select option:not([value=""])').first().waitFor({ state: "attached", timeout: 20000 });
await field(page, "Projekt").selectOption({ index: 1 });

const from = process.env.FROM ?? "2026-07-01";
const to = process.env.TO ?? "2026-09-01";
await field(page, "Från och med").fill(from);
await field(page, "Till och med").fill(to);
await page.getByRole("button", { name: "Generera Arbetsdagbok" }).click();

try {
  await page.getByRole("button", { name: /Spara som PDF/ }).waitFor({ timeout: 60000 });
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
