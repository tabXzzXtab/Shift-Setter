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

export type DocPayload = {
  cover: {
    adress: string;
    bolag: string;
    orgnr: string;
    project: string;
  };
  days: DocDay[];
};

/** VERBATIM from the DocMaker template. */
export function parseHours(value: string | number | null | undefined): number {
  if (!value) return 0;
  const normalized = String(value).trim().replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

/** VERBATIM from the DocMaker template, apart from row.passTyp1 -> row.hours. */
export function sumOrdinarieTid(days: DocDay[] | null | undefined): string {
  let total = 0;
  (days || []).forEach((day) => {
    (day.rows || []).forEach((row) => {
      total += parseHours(row.hours);
    });
  });
  const rounded = Math.round(total * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
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
 * The company footer.
 *
 * loadCompany() read config/company.json from disk. In a static export there is
 * no disk to read, so the values ship as a constant -- taken verbatim from
 * docs/docmaker-template/company.json. Hardcoded Bella Service, identical on
 * every page (spec Section 8, Settled).
 */
export const COMPANY = {
  postadressLabel: "Postadress Adress:",
  postadress: ["Söderto 3276, 242 93 Hörby"],
  telefonLabel: "Telefon",
  telefon: "073-398 78 68",
  bankgiroLabel: "Bankgiro",
  bankgiro: "443-4551",
  orgnote: "Godkänd för F-skatt",
  orgnrLabel: "Org.nr",
  orgnr: "556788-2369",
  momsregLabel: "Momsreg.nr",
  momsregnr: "CEFFSTA99339001",
} as const;
