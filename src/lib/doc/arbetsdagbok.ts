/**
 * The Arbetsdagbok payload and its arithmetic.
 *
 * Ported from docs/docmaker-template/pdf-template.js per spec Section 8b.
 *
 * parseHours and sumOrdinarieTid are VERBATIM apart from the field rename.
 * Fifteen lines, pure, Swedish decimal comma in and out. Rewriting them is how
 * you get silently wrong totals on a legal document, so they are not rewritten.
 *
 * Field renames on port, also per 8b:
 *   passTyp1 -> hours
 *   passTyp2 -> passTider
 *   project  -> vadViGjorde
 * The old names existed only to keep DocMaker's saved drafts importable, and
 * there are none to keep.
 */

export type DocRow = {
  arbetare: string;
  hours: string;
  passTider: string;
  vadViGjorde: string;
};

export type DocDay = {
  date: string;
  rows: DocRow[];
};

/**
 * The company issuing the document: its header and its footer.
 *
 * FROM THE TENANCY, NOT THE CODE. These were Bella Service AB's constants, so
 * every company's Arbetsdagbok carried Bella's identity. Name and org.nr come
 * from public.tenant; the rest from public.tenant_branding (migration
 * 20260929140000), where address, contact and phone are required -- the
 * database refuses to file a document without them -- and the rest optional.
 */
export type DocSender = {
  name: string;
  orgnr: string;
  address: string;
  contact: string;
  phone: string;
  bankgiro: string | null;
  momsreg: string | null;
  fSkatt: boolean;
  /** Absent: the company name is printed where the logo would be. */
  logo: { bytes: Uint8Array; type: "png" | "jpg"; url: string } | null;
  /**
   * The company HAS a logo and it could not be read. The name still prints in
   * its place, but the page says so: a document that quietly lost its logo is
   * the failure an inlined image was chosen to prevent.
   */
  logoFailed: boolean;
};

export type DocPayload = {
  cover: {
    adress: string;
    bolag: string;
    orgnr: string;
    project: string;
  };
  sender: DocSender;
  days: DocDay[];
};

/** VERBATIM from the DocMaker template. */
export function parseHours(value: string | number | null | undefined): number {
  if (!value) return 0;
  const normalized = String(value).trim().replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The cover's Ordinarie tid: every row's hours, EXACTLY.
 *
 * DocMaker rounded the total to one decimal, so three rows of 0,25 printed as
 * "0,8h" -- on a legal document, a figure that is not the sum of the figures
 * printed under it. Hours are stored as numeric(4,2), so each row is a whole
 * number of hundredths: they are added as integers (no floating-point drift)
 * and printed with up to two decimals, Swedish comma, no trailing zeros.
 */
export function sumOrdinarieTid(days: DocDay[] | null | undefined): string {
  let hundredths = 0;
  (days || []).forEach((day) => {
    (day.rows || []).forEach((row) => {
      hundredths += Math.round(parseHours(row.hours) * 100);
    });
  });
  const total = hundredths / 100;
  const formatted = Number.isInteger(total) ? String(total) : String(total).replace(".", ",");
  return `${formatted}h`;
}

/**
 * Stockholm-anchored, not machine-local. Invariant 9.
 *
 * The DocMaker original used date.getFullYear() and friends, which read the
 * machine's zone. A document generated from a laptop set to UTC would have
 * carried a "Skapad" stamp an hour or two out.
 */
export function formatTimestamp(date: Date): string {
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * The footer's WORDS. The values are the sender's (DocSender); only the
 * labels are the document's own, verbatim from the DocMaker template's
 * company.json, plus Kontakt for the one field the template never had.
 */
export const FOOTER = {
  postadressLabel: "Postadress:",
  telefonLabel: "Telefon",
  kontaktLabel: "Kontakt",
  bankgiroLabel: "Bankgiro",
  fSkatt: "Godkänd för F-skatt",
  orgnrLabel: "Org.nr",
  momsregLabel: "Momsreg.nr",
} as const;

/** The footer's right-hand column: only what the sender has, closed up. */
export function footerRight(s: DocSender): string[] {
  return [
    s.bankgiro && `${FOOTER.bankgiroLabel}: ${s.bankgiro}`,
    s.fSkatt && FOOTER.fSkatt,
    `${FOOTER.orgnrLabel}: ${s.orgnr}`,
    s.momsreg && `${FOOTER.momsregLabel}: ${s.momsreg}`,
  ].filter((l): l is string => Boolean(l));
}
