#!/usr/bin/env node
/**
 * Prove the Arbetsdagbok downloads as a file, with no print dialog.
 *
 *   node scripts/pdf-download-check.mjs <from> <to> [project name]
 *
 * Three things are checked, because the first two would pass on a broken file:
 *   - a real download event fires and the suggested filename matches the
 *     agreed format
 *   - the bytes are a PDF that opens, with the header and footer on every page
 *   - the band colours are present, sampled from the rendered page -- these
 *     are drawn now, not CSS backgrounds, so nothing can strip them
 *
 * A print dialog would block the browser instead of producing a file, so if
 * one appears this times out rather than passing quietly.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/Shift-Setter";
const [FROM, TO, PROJECT] = process.argv.slice(2);
if (!FROM || !TO) {
  console.error("usage: node scripts/pdf-download-check.mjs <from> <to> [project name]");
  process.exit(1);
}
mkdirSync("artifacts", { recursive: true });

const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };
const f = (page, l) => page.locator(`label:has(span:text-is("${l}"))`).locator("input, select").first();

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  acceptDownloads: true,
});
const page = await ctx.newPage();

// If a print dialog ever opened, this would catch it rather than hang forever.
let printed = false;
await page.exposeFunction("__printCalled", () => { printed = true; });
await page.addInitScript(() => {
  const orig = window.print;
  window.print = function () { window.__printCalled(); return orig.apply(this, arguments); };
});

await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
await page.locator("form").waitFor({ timeout: 20000 });
await f(page, "E-post").fill(required("WALKTHROUGH_ADMIN_EMAIL"));
await f(page, "Lösenord").fill(required("WALKTHROUGH_ADMIN_PASSWORD"));
await page.getByRole("button", { name: "Logga in" }).click();
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });

await page.goto(`${BASE}/arbetsdagbok/`, { waitUntil: "networkidle" });
await page.locator('label:has(span:text-is("Projekt")) select option:not([value=""])')
  .first().waitFor({ state: "attached", timeout: 20000 });
// Named, not indexed: the first option is whichever project sorts first, and
// that one may carry no shifts in the chosen range.
await f(page, "Projekt").selectOption(PROJECT ? { label: PROJECT } : { index: 1 });
const projectName = await page.locator('label:has(span:text-is("Projekt")) select option:checked').innerText();
await f(page, "Från och med").fill(FROM);
await f(page, "Till och med").fill(TO);
await page.getByRole("button", { name: "Generera Arbetsdagbok" }).click();

try { await page.getByRole("button", { name: "Ladda ner PDF" }).waitFor({ timeout: 40000 }); }
catch { fail(`generation refused: ${await page.locator("main").innerText()}`); }

// ---- the download -----------------------------------------------------------
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 40000 }),
  page.getByRole("button", { name: "Ladda ner PDF" }).click(),
]);

const suggested = download.suggestedFilename();
const out = path.join("artifacts", suggested);
await download.saveAs(out);
console.log(`\ndownloaded: ${suggested}`);

if (printed) fail("window.print() was called -- the print dialog is still in the path");

// [firstDate]-[lastDate]-[year]-[projektnamn].pdf, DDMon, all lowercase
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
const ddmon = (ymd) => `${ymd.split("-")[2]}${MONTHS[Number(ymd.split("-")[1]) - 1]}`;
const slug = projectName.trim().toLowerCase()
  .replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/[éè]/g, "e")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const expected = `${ddmon(FROM)}-${ddmon(TO)}-${TO.slice(0, 4)}-${slug}.pdf`;

console.log(`expected:   ${expected}`);
if (suggested !== expected) fail(`filename mismatch`);
if (suggested !== suggested.toLowerCase()) fail("filename is not all lowercase");

// ---- the bytes --------------------------------------------------------------
const bytes = new Uint8Array(readFileSync(out));
if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") fail("not a PDF");

// Measured BEFORE getDocument: pdf.js takes ownership of the array it is
// given and detaches the buffer, so reading .length afterwards reports zero.
const sizeKb = (bytes.length / 1024).toFixed(0);

const doc = await pdfjs.getDocument({
  data: bytes,
  // Helvetica is a standard font -- deliberately NOT embedded, which is why
  // the file is small. This build of pdf.js asks for LiberationSans TTFs it
  // does not ship, so the local system font stands in for the preview render.
  // It has no bearing on the PDF itself; every reader carries Helvetica.
  useSystemFonts: true,
}).promise;
console.log(`pages:      ${doc.numPages}   size: ${sizeKb} KB`);

let bad = 0;
for (let i = 1; i <= doc.numPages; i++) {
  const p = await doc.getPage(i);
  const text = (await p.getTextContent()).items.map((x) => x.str).join(" ");
  const hasHeader = /Arbetsdagbok/.test(text);
  const hasFooter = /556788-2369/.test(text);
  if (!hasHeader || !hasFooter) { bad++; console.log(`  p${i}: MISSING ${!hasHeader ? "header" : ""} ${!hasFooter ? "footer" : ""}`); }
}
if (bad) fail(`${bad} page(s) missing the header or footer`);
console.log(`header and footer on all ${doc.numPages} pages`);

// ---- the bands --------------------------------------------------------------
const SCALE = 2;
const pg = await doc.getPage(2);
const vp = pg.getViewport({ scale: SCALE });
const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
const cx = c.getContext("2d");
cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
await pg.render({ canvas: c, canvasContext: cx, viewport: vp }).promise;

const head = (await pg.getTextContent()).items.find((i) => i.str.trim() === "Arbetare");
if (!head) fail("no day table on page 2");
const x = Math.round(head.transform[4] * SCALE) - 12;
const y = Math.round(vp.height - head.transform[5] * SCALE) - 4;
const [r, g, b] = cx.getImageData(x, y, 1, 1).data;
console.log(`band:       rgb(${r}, ${g}, ${b})  expected 251,239,216`);
if (Math.abs(r - 251) > 6 || Math.abs(g - 239) > 6 || Math.abs(b - 216) > 6) {
  fail("the cream header band is not in the downloaded PDF");
}

const shot = path.join("artifacts", "52-nedladdad-sida2.png");
const { writeFileSync } = await import("node:fs");
writeFileSync(shot, c.toBuffer("image/png"));

await browser.close();
console.log(`\nONE TAP, ONE FILE. No print dialog. Rendered page saved to ${shot}\n`);
