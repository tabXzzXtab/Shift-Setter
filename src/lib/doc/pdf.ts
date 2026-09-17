import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { COMPANY, formatTimestamp, sumOrdinarieTid, type DocPayload } from "./arbetsdagbok";
import { LOGO_DATA_URL } from "./logo";

/**
 * The Arbetsdagbok as a real PDF, built in the browser.
 *
 * There is no server, so nothing can render this for us, and window.print()
 * cannot be told to save a file -- it always opens a dialog. So the document is
 * drawn here instead: vector text, selectable, and the band colours are drawn
 * rather than being a CSS background the print dialog can economise away.
 *
 * Helvetica rather than an embedded font. It is one of the fourteen fonts every
 * PDF reader carries, so nothing is embedded, and WinAnsi covers å, ä and ö --
 * which is the only reason it is safe for Swedish. Any glyph outside WinAnsi
 * would throw at draw time, so the text is sanitised before it is drawn.
 *
 * The measurements come from the DocMaker template (spec Section 8b), converted
 * from millimetres. The layout is the same document; only the renderer differs.
 */

const MM = 2.834645669;                 // 1mm in PDF points
const mm = (v: number) => v * MM;

const PAGE_W = mm(210);
const PAGE_H = mm(297);
const MARGIN_X = mm(18);
const CONTENT_W = PAGE_W - MARGIN_X * 2;

// The header band, then the first line of content.
const HEADER_TOP = mm(20);
const LOGO_SIZE = mm(18);
const CONTENT_TOP = mm(52);             // 20 header + 18 logo + 14 gap
const CONTENT_BOTTOM = mm(265);         // keeps clear of the footer band

// Table geometry, verbatim ratios from the template: 1.1fr 1fr 1.3fr 1.6fr
const COL_RATIOS = [1.1, 1, 1.3, 1.6];
const COL_W = COL_RATIOS.map((r) => (CONTENT_W * r) / COL_RATIOS.reduce((a, b) => a + b, 0));
const CELL_PAD_X = mm(4);
const CELL_PAD_Y = mm(3);

const BAND_HEAD = rgb(0xfb / 255, 0xef / 255, 0xd8 / 255);
const BAND_ZEBRA = rgb(0xfd / 255, 0xf9 / 255, 0xf1 / 255);
const INK = rgb(0x1a / 255, 0x1a / 255, 0x1a / 255);
const INK_HEAD = rgb(0x11 / 255, 0x11 / 255, 0x11 / 255);
const INK_COLHEAD = rgb(0x30 / 255, 0x3c / 255, 0x54 / 255);
const INK_FOOT = rgb(0x76 / 255, 0x76 / 255, 0x76 / 255);
const RULE_FOOT = rgb(0xcf / 255, 0xcf / 255, 0xcf / 255);

/**
 * WinAnsi cannot encode every character a human might paste into "Vad Vi
 * Gjorde". Rather than throw mid-document, the few that matter are folded to
 * their ASCII equivalent and anything still unencodable becomes a question
 * mark -- a wrong glyph in one cell beats no document at all.
 */
function winAnsi(text: string): string {
  return (text ?? "")
    .replace(/[–—]/g, "-")     // en/em dash
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x00-ÿ]/g, "?");
}

type Ctx = { doc: PDFDocument; font: PDFFont; bold: PDFFont; logo: Awaited<ReturnType<PDFDocument["embedPng"]>> };

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = winAnsi(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxW) line = next;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Header and footer, on every page. Drawn as content, so nothing strips them. */
function furnish(page: PDFPage, ctx: Ctx) {
  const scale = LOGO_SIZE / Math.max(ctx.logo.width, ctx.logo.height);
  page.drawImage(ctx.logo, {
    x: MARGIN_X,
    y: PAGE_H - HEADER_TOP - LOGO_SIZE,
    width: ctx.logo.width * scale,
    height: ctx.logo.height * scale,
  });

  const title = "Arbetsdagbok";
  const titleSize = 19;
  page.drawText(title, {
    x: PAGE_W - MARGIN_X - ctx.bold.widthOfTextAtSize(title, titleSize),
    y: PAGE_H - HEADER_TOP - LOGO_SIZE / 2 - titleSize * 0.35,
    size: titleSize, font: ctx.bold, color: INK_HEAD,
  });

  const footTop = PAGE_H - mm(273);
  page.drawLine({
    start: { x: MARGIN_X, y: footTop },
    end: { x: PAGE_W - MARGIN_X, y: footTop },
    thickness: 0.75, color: RULE_FOOT,
  });

  const size = 8;
  const line = (x: number, i: number, text: string, align: "left" | "right" = "left") => {
    const w = ctx.font.widthOfTextAtSize(winAnsi(text), size);
    page.drawText(winAnsi(text), {
      x: align === "right" ? x - w : x,
      y: footTop - mm(3) - size - i * (size * 1.5),
      size, font: ctx.font, color: INK_FOOT,
    });
  };

  line(MARGIN_X, 0, COMPANY.postadressLabel);
  line(MARGIN_X, 1, COMPANY.postadress.join(", "));
  line(MARGIN_X + CONTENT_W * 0.42, 0, `${COMPANY.telefonLabel}: ${COMPANY.telefon}`);
  const right = PAGE_W - MARGIN_X;
  line(right, 0, `${COMPANY.bankgiroLabel}: ${COMPANY.bankgiro}`, "right");
  line(right, 1, COMPANY.orgnote, "right");
  line(right, 2, `${COMPANY.orgnrLabel}: ${COMPANY.orgnr}`, "right");
  line(right, 3, `${COMPANY.momsregLabel}: ${COMPANY.momsregnr}`, "right");
}

function addPage(ctx: Ctx) {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  furnish(page, ctx);
  return page;
}

export async function buildArbetsdagbokPdf(payload: DocPayload): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Arbetsdagbok");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(LOGO_DATA_URL);
  const ctx: Ctx = { doc, font, bold, logo };

  // ---- page 1: the cover, always this layout and nothing else on it --------
  const cover = addPage(ctx);
  let y = PAGE_H - CONTENT_TOP;

  const label = (l: string, v: string, size = 10) => {
    const lw = bold.widthOfTextAtSize(l, size);
    // The beställare block is right-aligned, as in the template.
    const total = lw + font.widthOfTextAtSize(` ${winAnsi(v)}`, size);
    const x = PAGE_W - MARGIN_X - total;
    cover.drawText(l, { x, y, size, font: bold, color: INK });
    cover.drawText(winAnsi(v), { x: x + lw + font.widthOfTextAtSize(" ", size), y, size, font, color: INK });
    y -= size * 1.8;
  };

  label("Skapad:", formatTimestamp(new Date()));
  const bTitle = "Beställare";
  cover.drawText(winAnsi(bTitle), {
    x: PAGE_W - MARGIN_X - bold.widthOfTextAtSize(winAnsi(bTitle), 10),
    y, size: 10, font: bold, color: INK,
  });
  y -= 10 * 1.8;
  label("Adress:", payload.cover.adress);
  label("Bolag:", payload.cover.bolag);
  label("Org nummer:", payload.cover.orgnr);

  y -= mm(10);
  cover.drawLine({
    start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y },
    thickness: 1.25, color: INK_HEAD,
  });
  y -= mm(10);

  const kv = (l: string, v: string) => {
    const size = 11;
    cover.drawText(l, { x: MARGIN_X, y, size, font: bold, color: INK });
    cover.drawText(winAnsi(v), {
      x: MARGIN_X + bold.widthOfTextAtSize(l, size) + font.widthOfTextAtSize(" ", size),
      y, size, font, color: INK,
    });
    y -= mm(8);
  };
  kv("Project:", payload.cover.project);
  const total = sumOrdinarieTid(payload.days);
  cover.drawText(`Ordinarie tid: ${total}`, { x: MARGIN_X, y, size: 11, font: bold, color: INK });
  y -= mm(6);

  cover.drawLine({
    start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y },
    thickness: 1.25, color: INK_HEAD,
  });

  // The approval block sits at the foot of the cover. Always blank -- signed by
  // hand -- so these are rules, not fields.
  let ay = PAGE_H - mm(232);
  cover.drawText("GODKÄND AV".normalize(), { x: MARGIN_X, y: ay, size: 10.5, font: bold, color: INK });
  ay -= mm(14);
  for (const l of ["Ort & datum:", "Signatur:"]) {
    const lw = bold.widthOfTextAtSize(winAnsi(l), 10.5);
    cover.drawText(winAnsi(l), { x: MARGIN_X, y: ay, size: 10.5, font: bold, color: INK });
    cover.drawLine({
      start: { x: MARGIN_X + lw + mm(3), y: ay - 2 },
      end: { x: PAGE_W - MARGIN_X, y: ay - 2 },
      thickness: 1, color: INK_HEAD,
    });
    ay -= mm(14);
  }

  // ---- page 2 onward: the day tables, nothing else ------------------------
  let page = addPage(ctx);

  const TOP = PAGE_H - CONTENT_TOP;
  const FLOOR = PAGE_H - CONTENT_BOTTOM;   // content stops here, clear of the footer
  let cursor = TOP;

  const HEAD_SIZE = 9;
  const CELL_SIZE = 9.5;
  const DATE_SIZE = 12.5;
  const LINE_H = CELL_SIZE * 1.35;
  const HEADING_H = DATE_SIZE * 1.4 + mm(3);
  const HEAD_H = HEAD_SIZE * 1.35 + CELL_PAD_Y * 2;
  const COL_HEADS = ["Arbetare", "Pass Timmar", "Pass Tider", "Vad Vi Gjorde"];

  const breakPage = () => {
    page = addPage(ctx);
    cursor = TOP;
  };

  /**
   * The date, then the column band. Drawn again at the top of every page a day
   * continues onto: a table whose columns are labelled only on the page it
   * started on cannot be read from page two, and a bare repeat of the date
   * reads as a second entry for the same day rather than the rest of one.
   */
  const openDay = (date: string, continued: boolean) => {
    page.drawText(winAnsi(continued ? `${date} (forts.)` : date), {
      x: MARGIN_X, y: cursor - DATE_SIZE, size: DATE_SIZE, font: bold, color: INK_HEAD,
    });
    cursor -= HEADING_H;

    // Header band, drawn as a filled rectangle -- not a background.
    page.drawRectangle({
      x: MARGIN_X, y: cursor - HEAD_H, width: CONTENT_W, height: HEAD_H, color: BAND_HEAD,
    });
    let x = MARGIN_X;
    COL_HEADS.forEach((h, i) => {
      page.drawText(h, {
        x: x + CELL_PAD_X, y: cursor - CELL_PAD_Y - HEAD_SIZE, size: HEAD_SIZE,
        font: bold, color: INK_COLHEAD,
      });
      x += COL_W[i]!;
    });
    cursor -= HEAD_H;
  };

  for (const day of payload.days) {
    const cols = [
      day.rows.map((r) => r.arbetare),
      day.rows.map((r) => r.hours),
      day.rows.map((r) => r.passTider),
      day.rows.map((r) => r.vadViGjorde),
    ];

    // Measure the whole block first: a day table is kept together where it
    // fits, the same intent as page-break-inside: avoid.
    const wrapped = day.rows.map((_, i) =>
      cols.map((c, ci) => wrap(c[i] ?? "", font, CELL_SIZE, COL_W[ci]! - CELL_PAD_X * 2)),
    );
    const rowLines = wrapped.map((r) => Math.max(...r.map((lines) => lines.length)));
    const rowHeights = rowLines.map((n) => n * LINE_H + CELL_PAD_Y * 2);
    const blockH = HEADING_H + HEAD_H + rowHeights.reduce((a, b) => a + b, 0);

    /**
     * Where a day fits on no page at all it is SPLIT rather than drawn past the
     * bottom of the sheet. Drawing past it does not merely look wrong: rows
     * below the page edge are in the file and in no reader, so a day with
     * enough workers on it filed a document that was silently missing them.
     *
     * A split day still may not START so far down a page that only its heading
     * lands there, so an oversized one needs room for the heading, the band and
     * one line of a row. Anything that fits on a page needs the whole block.
     */
    const startNeed = Math.min(blockH, HEADING_H + HEAD_H + LINE_H + CELL_PAD_Y * 2);
    const need = blockH > TOP - FLOOR ? startNeed : blockH;
    if (cursor - need < FLOOR && cursor < TOP - 1) breakPage();

    openDay(day.date, false);

    for (let i = 0; i < day.rows.length; i++) {
      const lines = rowLines[i]!;
      let from = 0;                        // first wrapped line not yet drawn

      while (from < lines) {
        // How many lines still fit above the footer. Never a partial one: a row
        // is cut BETWEEN its lines, never through one.
        const room = Math.floor((cursor - FLOOR - CELL_PAD_Y * 2) / LINE_H);
        if (room < 1) {
          breakPage();
          openDay(day.date, true);
          continue;
        }

        const take = Math.min(lines - from, room);
        const h = take * LINE_H + CELL_PAD_Y * 2;

        // The stripe follows the ROW, not the fragment, so a row split across a
        // page boundary carries the same fill onto both halves.
        if (i % 2 === 0) {
          page.drawRectangle({
            x: MARGIN_X, y: cursor - h, width: CONTENT_W, height: h, color: BAND_ZEBRA,
          });
        }

        let cx = MARGIN_X;
        wrapped[i]!.forEach((cell, ci) => {
          cell.slice(from, from + take).forEach((ln, li) => {
            page.drawText(ln, {
              x: cx + CELL_PAD_X,
              y: cursor - CELL_PAD_Y - CELL_SIZE - li * LINE_H,
              size: CELL_SIZE, font, color: INK,
            });
          });
          cx += COL_W[ci]!;
        });

        cursor -= h;
        from += take;
      }
    }

    cursor -= mm(9);
  }

  return doc.save();
}

/**
 * [firstDate]-[lastDate]-[year]-[projektnamn].pdf
 *
 *   20Jul-28Aug-2026-demoprojektet.pdf
 *
 * The month abbreviation carries a capital; the project slug is lowercase.
 * Only the slug is lowercased -- applying it to the whole string would undo
 * the Mon, which is exactly what happened the first time.
 *
 * The dates are the range the admin chose, not the first and last day that
 * happen to carry shifts -- the document covers the range, and two exports of
 * the same range must produce the same name.
 */
const FILENAME_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function arbetsdagbokFilename(from: string, to: string, project: string): string {
  const ddmon = (ymd: string) => {
    const [, m, d] = ymd.split("-");
    return `${d}${FILENAME_MONTHS[Number(m) - 1] ?? "Xxx"}`;
  };

  const slug = project
    .toLowerCase()
    .replace(/[åä]/g, "a").replace(/ö/g, "o")
    .replace(/[éè]/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "projekt";

  return `${ddmon(from)}-${ddmon(to)}-${to.slice(0, 4)}-${slug}.pdf`;
}
