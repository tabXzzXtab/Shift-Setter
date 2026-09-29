#!/usr/bin/env node
/**
 * The Arbetsdagbok's sender: the real pdf.ts, fed the real sender, read back.
 *
 *   node scripts/pdf-sender-check.mjs [pdfModulePath]
 *
 * Loads Bella's sender the way the page does (tenant + tenant_branding + the
 * logo from the branding bucket), signed in as DEMO_ADMIN -- READ ONLY, nothing
 * is filed -- builds the PDF, and reads its text and images back with pdfjs:
 * Bella's own footer and logo on every page; and for a company with no logo
 * and no optional fields, its name where the logo was and nothing of Bella's.
 *
 * Why offline rather than through the Arbetsdagbok screen: generating there
 * FILES a document, and filing makes the hours visible to the workers
 * (invariant 10). This proves the renderer without touching a real record.
 *
 * The negative control is the argument: point it at a copy of the pre-branding
 * pdf.ts (with its arbetsdagbok.ts and logo.ts beside it) and the other-company
 * checks fail, because that code printed Bella on everybody's document.
 */
import { createJiti } from "jiti";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { required } from "./env.mjs";

const root = process.cwd();
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(root, "src") } });
const pdfPath = process.argv[2] ?? path.join(root, "src/lib/doc/pdf.ts");
const { buildArbetsdagbokPdf } = await jiti.import(pdfPath);
const { getSupabase } = await jiti.import("@/lib/supabase/client");
const { loadSender } = await jiti.import("@/lib/doc/sender");

let bad = 0;
const check = (ok, what) => { console.log(`  ${ok ? "ok " : "BAD"} ${what}`); if (!ok) bad++; };

const sb = getSupabase();
const { error } = await sb.auth.signInWithPassword({
  email: required("DEMO_ADMIN_EMAIL"), password: required("DEMO_ADMIN_PASSWORD"),
});
if (error) throw error;
const sender = await loadSender("2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164");
await sb.auth.signOut();

const payload = (s) => ({
  cover: { adress: "Kundvägen 1", bolag: "Kund AB", orgnr: "556000-0001", project: "Provbygget" },
  sender: s,
  days: [{ date: "2026-09-01", rows: [{ arbetare: "Ada", hours: "8", passTider: "07:00–16:00", vadViGjorde: "Murning" }] }],
});

async function read(bytes) {
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const text = (await p.getTextContent()).items.map((it) => it.str).join(" | ");
    const ops = await p.getOperatorList();
    const images = ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length;
    pages.push({ text, images });
  }
  return pages;
}

console.log("== Bella, as loaded from tenant + tenant_branding + the bucket");
check(sender.name === "Bella Service AB" && sender.orgnr === "556788-2369", `sender: ${sender.name}, ${sender.orgnr}`);
check(sender.logo?.type === "png" && sender.logo.bytes.length === 412666 && !sender.logoFailed, `logo: ${sender.logo?.bytes.length} bytes`);
const full = await read(await buildArbetsdagbokPdf(payload(sender)));
for (const [i, p] of full.entries()) {
  for (const want of ["Söderto 3276, 242 93 Hörby", "Telefon: 073-398 78 68", "Kontakt: Antoine",
                      "Bankgiro: 443-4551", "Godkänd för F-skatt", "Org.nr: 556788-2369", "Momsreg.nr: CEFFSTA99339001"]) {
    check(p.text.includes(want), `page ${i + 1}: "${want}"`);
  }
  check(p.images >= 1, `page ${i + 1}: the logo is drawn (${p.images} image)`);
}

console.log("== another company: no logo, no bankgiro, no momsreg, no F-skatt");
const plain = { ...sender, name: "Annat Bygg AB", orgnr: "559999-0001", address: "Annan väg 2", contact: "Ola",
  phone: "070-1", bankgiro: null, momsreg: null, fSkatt: false, logo: null, logoFailed: false };
const bare = await read(await buildArbetsdagbokPdf(payload(plain)));
for (const [i, p] of bare.entries()) {
  check(p.text.includes("Annat Bygg AB"), `page ${i + 1}: the company name where the logo would be`);
  check(p.images === 0, `page ${i + 1}: no image at all`);
  check(p.text.includes("Org.nr: 559999-0001") && p.text.includes("Kontakt: Ola"), `page ${i + 1}: its own org.nr and contact`);
  check(!/Bankgiro|Momsreg|F-skatt|Söderto|Bella|556788-2369/.test(p.text), `page ${i + 1}: nothing of Bella's, no empty optional lines`);
}

console.log(bad ? `\n${bad} BAD` : "\nALL OK");
process.exit(bad ? 1 : 0);
