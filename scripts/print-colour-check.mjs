#!/usr/bin/env node
/**
 * Generate the Arbetsdagbok the way a human's print dialog does -- with
 * "Background graphics" UNTICKED, which is Chrome's default -- and prove the
 * table bands still print.
 *
 * They did not, once. CSS backgrounds are stripped in that mode, and
 * print-color-adjust: exact does NOT override it: the checkbox wins. Measured,
 * not assumed. The bands are drawn as <img> content instead, which prints
 * either way, and this guards that from being "simplified" back.
 */
import { chromium, devices } from "playwright";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import postgres from "pg";
import { connectionString, required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/Shift-Setter";
const DATE = process.argv[2];
if (!DATE) { console.error("usage: node scripts/print-colour-check.mjs <YYYY-MM-DD with a confirmed day>"); process.exit(1); }
mkdirSync("artifacts", { recursive: true });
const OUT = path.join("artifacts", "print-utan-bakgrund.pdf");

const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };
/**
 * Which project to document -- asked of the database, not taken as option
 * index 1. That index is alphabetical and lands on whichever project happens
 * to sort first, which after a demo reset is an empty one: the check then
 * reported a colour failure that was really "there is nothing to document".
 */
const pickProject = async (date) => {
  const db = new postgres.Client({
    connectionString: connectionString(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await db.connect();
  const { rows } = await db.query(`
    select pr.name
    from public.project_day pd
    join public.project pr on pr.id = pd.project_id and pr.deleted_at is null
    where pd.work_date = $1::date and pd.confirmed_at is not null
      and exists (select 1 from public.pass p
                  where p.project_id = pr.id and p.work_date = pd.work_date
                    and p.deleted_at is null)
    order by pr.name limit 1`, [date]);
  await db.end();
  if (!rows.length) fail(`no project has a confirmed day on ${date}`);
  return rows[0].name;
};

const f = (page, l) => page.locator(`label:has(span:text-is("${l}"))`).locator("input, select").first();

const PROJEKT = await pickProject(DATE);
console.log(`documenting ${PROJEKT} on ${DATE}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm" });
const page = await ctx.newPage();

await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
await page.locator("form").waitFor({ timeout: 20000 });
await f(page, "E-post").fill(required("WALKTHROUGH_ADMIN_EMAIL"));
await f(page, "Lösenord").fill(required("WALKTHROUGH_ADMIN_PASSWORD"));
await page.getByRole("button", { name: "Logga in" }).click();
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });

await page.goto(`${BASE}/arbetsdagbok/`, { waitUntil: "networkidle" });
await page.locator('label:has(span:text-is("Projekt")) select option:not([value=""])')
  .first().waitFor({ state: "attached", timeout: 20000 });
await f(page, "Projekt").selectOption({ label: PROJEKT });
await f(page, "Från och med").fill(DATE);
await f(page, "Till och med").fill(DATE);
await page.getByRole("button", { name: "Generera Arbetsdagbok" }).click();
try { await page.getByRole("button", { name: /Ladda ner PDF/ }).waitFor({ timeout: 40000 }); }
catch { fail(`generation refused: ${await page.locator("main").innerText()}`); }

await page.emulateMedia({ media: "print" });
writeFileSync(OUT, await page.pdf({
  format: "A4",
  printBackground: false,                       // the default a human gets
  margin: { top: "0", right: "0", bottom: "0", left: "0" },
}));
await browser.close();
console.log(`wrote ${OUT} (backgrounds disabled, as the print dialog defaults)`);

// ---- sample the bands -------------------------------------------------------
const SCALE = 2;
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(OUT)), useSystemFonts: false }).promise;
const pg = await doc.getPage(2);
const vp = pg.getViewport({ scale: SCALE });
const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
const cx = c.getContext("2d");
cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
await pg.render({ canvas: c, canvasContext: cx, viewport: vp }).promise;

// PDF y runs from the bottom; canvas y from the top.
const items = (await pg.getTextContent()).items;
const at = (item, dx, dy) => {
  const x = Math.round(item.transform[4] * SCALE) + dx;
  const y = Math.round(vp.height - item.transform[5] * SCALE) + dy;
  const [r, g, b] = cx.getImageData(x, y, 1, 1).data;
  return { r, g, b };
};

const head = items.find((i) => i.str.trim() === "Arbetare");
if (!head) fail("no day table on page 2");
const band = at(head, -12, -4);

const near = (p, R, G, B) => Math.abs(p.r - R) < 6 && Math.abs(p.g - G) < 6 && Math.abs(p.b - B) < 6;

console.log(`  header band: rgb(${band.r}, ${band.g}, ${band.b})  expected 251,239,216`);
if (!near(band, 251, 239, 216)) {
  fail("the cream header band did not print with backgrounds off");
}
console.log("\nBANDS PRINT WITHOUT 'Background graphics' -- the colours survive a default print.");
