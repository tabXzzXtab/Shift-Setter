#!/usr/bin/env node
/**
 * Put the generated Arbetsdagbok beside a DocMaker one.
 *
 *   node scripts/compare-pdf.mjs <ours.pdf> <docmaker.pdf>
 *
 * Two things are checked, because a picture alone would not catch either:
 *
 *  - Structure. The header must now appear on EVERY page. The DocMaker template
 *    rendered it once after the cover, so pages 3 onward lost it -- spec 8b
 *    calls that a bug to fix on the port, so the comparison must show ours
 *    fixed and the original not.
 *  - Text. Cover values, the Ordinarie tid total, the column headings and the
 *    hardcoded footer, extracted per page rather than eyeballed.
 *
 * Both files are also rasterised side by side so the layout can be judged by
 * eye, which is the only way to judge a layout.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const [oursPath, theirsPath] = process.argv.slice(2);
if (!oursPath || !theirsPath) {
  console.error("usage: node scripts/compare-pdf.mjs <ours.pdf> <docmaker.pdf>");
  process.exit(1);
}

async function load(file) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(file)),
    // No worker in Node, and no system fonts to hunt for.
    useSystemFonts: false,
  }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const text = (await page.getTextContent()).items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
    pages.push({ page, text });
  }
  return { doc, pages };
}

async function render(page, scale = 1.4) {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

const ours = await load(oursPath);
const theirs = await load(theirsPath);

const row = (label, a, b) => console.log(`  ${label.padEnd(34)} ${String(a).padEnd(26)} ${b}`);

console.log(`\n${"".padEnd(36)}${"SHIFT SETTER".padEnd(26)}DOCMAKER`);
console.log("-".repeat(92));
row("pages", ours.doc.numPages, theirs.doc.numPages);

const headerOn = (d) => d.pages.filter((p) => /Arbetsdagbok/i.test(p.text)).length;
const footerOn = (d) => d.pages.filter((p) => /556788-2369/.test(p.text)).length;

row(
  "pages carrying the header",
  `${headerOn(ours)}/${ours.doc.numPages}`,
  `${headerOn(theirs)}/${theirs.doc.numPages}`,
);
row(
  "pages carrying the footer",
  `${footerOn(ours)}/${ours.doc.numPages}`,
  `${footerOn(theirs)}/${theirs.doc.numPages}`,
);

const find = (d, re) => {
  for (const p of d.pages) { const m = re.exec(p.text); if (m) return m[1].trim(); }
  return "—";
};

row("Ordinarie tid", find(ours, /Ordinarie tid:\s*([\d.,]+h)/), find(theirs, /Ordinarie tid:\s*([\d.,]+h)/));
row("Beställare bolag", find(ours, /Bolag:\s*(.+?)\s+Org/), find(theirs, /Bolag:\s*(.+?)\s+Org/));
row("Org nummer", find(ours, /Org nummer:\s*([\d-]+)/), find(theirs, /Org nummer:\s*([\d-]+)/));

// Spec Section 1 renames two columns: Pass Typ -> Pass Tider, Project ->
// Vad Vi Gjorde. DocMaker's shipped PDFs still carry the old names, so this
// row differing IS the rename having landed.
const headings = (d) => {
  const all = d.pages.map((p) => p.text).join(" ");
  const third = /Pass Timmar\s+(Pass Tider|Pass typ)/i.exec(all)?.[1] ?? "?";
  const fourth = /(Vad Vi Gjorde|Project)\s/i.exec(all.split("Pass Timmar")[1] ?? "")?.[1] ?? "?";
  return `${third} / ${fourth}`;
};
row("column 3 / column 4", headings(ours), headings(theirs));

// "Ort & datum" and "Signatur" are ALWAYS blank -- signed by hand. Extraction
// runs the footer onto the same line, so the test is that nothing but the
// footer follows.
const signBlank = (d) =>
  // The running header is painted last, so its title can land between the
  // signature lines and the footer in the extracted stream. That is paint
  // order, not content.
  /Signatur:\s*(Arbetsdagbok\s+)?(Postadress|$)/.test(d.pages[0].text)
    ? "blank (as it must be)" : "NOT BLANK";
row("Ort & datum / Signatur", signBlank(ours), signBlank(theirs));

console.log("\nOURS, page by page:");
ours.pages.forEach((p, i) => console.log(`  p${i + 1}: ${p.text.slice(0, 150)}${p.text.length > 150 ? "…" : ""}`));

// ---- side by side, page 1 and page 2 of each -------------------------------
mkdirSync("artifacts", { recursive: true });
const pick = async (d, n) => (d.pages[n] ? await render(d.pages[n].page) : null);

for (const [n, label] of [[0, "sida-1-omslag"], [1, "sida-2-dagar"]]) {
  const a = await pick(ours, n);
  const b = await pick(theirs, n);
  if (!a && !b) continue;

  const gap = 24, pad = 40, header = 46;
  const w = (a?.width ?? 0) + (b?.width ?? 0) + gap + pad * 2;
  const h = Math.max(a?.height ?? 0, b?.height ?? 0) + pad * 2 + header;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e9e9e9";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#111";
  ctx.font = "bold 22px sans-serif";
  if (a) ctx.fillText("SHIFT SETTER", pad, 32);
  if (b) ctx.fillText("DOCMAKER", pad + (a?.width ?? 0) + gap, 32);
  if (a) ctx.drawImage(a, pad, header + pad / 2);
  if (b) ctx.drawImage(b, pad + a.width + gap, header + pad / 2);

  const out = path.join("artifacts", `jamforelse-${label}.png`);
  writeFileSync(out, canvas.toBuffer("image/png"));
  console.log(`\nwrote ${out}`);
}
