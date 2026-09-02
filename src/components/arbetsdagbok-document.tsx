"use client";

import { COMPANY, formatTimestamp, sumOrdinarieTid, type DocPayload } from "@/lib/doc/arbetsdagbok";
import { LOGO_DATA_URL } from "@/lib/doc/logo";

/**
 * The Arbetsdagbok, rendered for print.
 *
 * Ported from docs/docmaker-template/pdf-template.js per spec Section 8b.
 *
 * TAKEN VERBATIM:
 *  - The print CSS. @page { size: A4; margin: 0 } with the BODY doing the
 *    insetting via padding. Page-margin CSS applies only to the first and last
 *    sheet, which is why the body carries it. This was solved the hard way once.
 *  - The day table as CSS Grid, 1.1fr 1fr 1.3fr 1.6fr. Not a <table>.
 *  - page-break-inside: avoid on day blocks, page-break-after: always on cover.
 *  - Footer as position: fixed; bottom: 14mm, which repeats per page in
 *    Chromium's print engine.
 *  - The logo base64-inlined, not linked.
 *
 * CHANGED ON PORT:
 *  - No adressChecked / bolagChecked / orgnrChecked. All three beställare
 *    fields always print: the document exists so the customer can see how many
 *    hours were worked on their job, so it cannot identify them incompletely.
 *  - THE HEADER NOW REPEATS ON EVERY PAGE. The original rendered it once after
 *    the cover, so pages 3 onward lost it. It is fixed like the footer, and the
 *    body's top padding grows from 20mm to 34mm to reserve the band -- the same
 *    trick the 30mm bottom padding already used for the footer.
 *  - formatTimestamp is Stockholm-anchored (invariant 9).
 *  - loadCompany() reads a constant, since a static export has no disk.
 */
export function ArbetsdagbokDocument({ payload }: { payload: DocPayload }) {
  const total = sumOrdinarieTid(payload.days);
  const timestamp = formatTimestamp(new Date());

  return (
    <>
      <style>{CSS}</style>

      {/*
        The whole document sits in one table so that <thead> can repeat the
        header on every page AND reserve the space it occupies. position:fixed
        repeats but reserves nothing, so the header printed straight over the
        top of the day table from page 2 onward. See the note in CSS below.
      */}
      <table className="ad-sheet">
        <thead>
          <tr>
            <td>
              <div className="ad-running-header">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="logo-img" src={LOGO_DATA_URL} alt="" />
                <div className="title">Arbetsdagbok</div>
              </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>

      <section className="cover-page">
        <div className="cover-meta">
          <div className="cover-line"><span className="cv-bold">Skapad:</span> {timestamp}</div>
          <div className="cover-line cv-bold">Beställare</div>
          <div className="cover-line"><span className="cv-bold">Adress:</span> {payload.cover.adress}</div>
          <div className="cover-line"><span className="cv-bold">Bolag:</span> {payload.cover.bolag}</div>
          <div className="cover-line"><span className="cv-bold">Org nummer:</span> {payload.cover.orgnr}</div>
        </div>

        <hr className="cover-divider" />

        <div className="cover-line cover-project"><span className="cv-bold">Project:</span> {payload.cover.project}</div>
        <div className="cover-line cv-bold cover-hours">Ordinarie tid: {total}</div>

        <hr className="cover-divider" />

        <div className="cover-approval">
          <div className="cv-heading">GODKÄND AV</div>
          {/* Always blank. Signed by hand. */}
          <div className="cover-signline"><span className="cv-bold">Ort &amp; datum:</span><span className="cv-blank" /></div>
          <div className="cover-signline"><span className="cv-bold">Signatur:</span><span className="cv-blank" /></div>
        </div>
      </section>

      {payload.days.map((day) => (
        <section className="day-block" key={day.date}>
          <div className="date-heading">{day.date}</div>
          <div className="table">
            <div className="row row-head">
              <div className="cell">Arbetare</div>
              <div className="cell">Pass Timmar</div>
              <div className="cell">Pass Tider</div>
              <div className="cell cell-project">Vad Vi Gjorde</div>
            </div>
            <div className="rows-list">
              {day.rows.map((r, i) => (
                <div className="row" key={i}>
                  <div className="cell">{r.arbetare}</div>
                  <div className="cell">{r.hours}</div>
                  <div className="cell">{r.passTider}</div>
                  <div className="cell cell-project">{r.vadViGjorde}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

            </td>
          </tr>
        </tbody>
      </table>

      <div className="ad-footer">
        <div>
          <div>{COMPANY.postadressLabel}</div>
          <div>{COMPANY.postadress.join(", ")}</div>
        </div>
        <div>{COMPANY.telefonLabel}: {COMPANY.telefon}</div>
        <div className="footer-legal">
          <div>{COMPANY.bankgiroLabel}: {COMPANY.bankgiro}</div>
          <div>{COMPANY.orgnote}</div>
          <div>{COMPANY.orgnrLabel}: {COMPANY.orgnr}</div>
          <div>{COMPANY.momsregLabel}: {COMPANY.momsregnr}</div>
        </div>
      </div>
    </>
  );
}

const CSS = `
@page { size: A4; margin: 0; }

.ad-doc, .ad-doc * { box-sizing: border-box; }

.ad-doc {
  /* VERBATIM from DocMaker. The body does the insetting, because @page margins
     apply only to the first and last sheet, and 30mm reserves the footer band.
     This was solved the hard way once already. */
  padding: 20mm 18mm 30mm 18mm;
  font-family: 'Segoe UI', Arial, sans-serif;
  color: #1a1a1a;
  font-size: 10.5pt;
  background: #fff;
}

/*
  The running header.

  Spec 8b asks for the header to repeat "like the footer" -- i.e. position:
  fixed. It does repeat that way, but it reserves NO space, and body padding
  insets only the first page, so from page 2 it prints over the day table.
  Proven, not assumed: artifacts/jamforelse-sida-2-dagar.png from the run
  before this change shows the collision.

  thead in a table is the mechanism that both repeats and reserves. The visual
  styling below is unchanged.
*/
.ad-sheet { width: 100%; border-collapse: collapse; }
.ad-sheet > thead { display: table-header-group; }
.ad-sheet td { padding: 0; vertical-align: top; }

.ad-running-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14mm;   /* DocMaker's header spacing, kept */
}
.ad-running-header .logo-img { height: 18mm; width: 18mm; object-fit: contain; }
.ad-running-header .title { font-size: 19pt; font-weight: 700; color: #111; letter-spacing: 0.2px; }

.cover-page {
  display: flex;
  flex-direction: column;
  min-height: 205mm;   /* the header now takes its space in flow on page 1 */
  page-break-after: always;
  break-after: page;
}
.cover-meta {
  width: fit-content;
  max-width: 90mm;
  margin-left: auto;
  text-align: left;
  margin-top: 2mm;
  font-size: 10pt;
  line-height: 1.8;
}
.cover-line { margin-bottom: 0; }
.cv-bold { font-weight: 700; }
.cover-divider { border: none; border-top: 1.25px solid #111; margin: 10mm 0; }
.cover-project, .cover-hours { font-size: 11pt; margin-bottom: 4mm; }
.cover-approval { margin-top: auto; padding-bottom: 4mm; }
.cv-heading { font-weight: 700; letter-spacing: 0.6px; margin-bottom: 12mm; }
.cover-signline {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  font-size: 10.5pt;
  margin-bottom: 10mm;
  white-space: nowrap;
}
.cv-blank { flex: 1; border-bottom: 1px solid #111; margin-bottom: 2px; }

.day-block { margin-bottom: 9mm; page-break-inside: avoid; }
.date-heading { font-size: 12.5pt; font-weight: 700; margin-bottom: 3mm; color: #111; }

.table { width: 100%; }
.row { display: grid; grid-template-columns: 1.1fr 1fr 1.3fr 1.6fr; }
.row-head { background: #FBEFD8; }
.row-head .cell { font-weight: 700; font-size: 9pt; color: #303c54; padding: 3mm 4mm; }
.rows-list .row:nth-child(odd) { background: #FDF9F1; }
.cell { padding: 3mm 4mm; font-size: 9.5pt; }

.ad-footer {
  position: fixed;
  bottom: 14mm;
  left: 18mm;
  right: 18mm;
  padding-top: 3mm;
  border-top: 0.75px solid #cfcfcf;
  display: grid;
  grid-template-columns: 1.3fr 1fr 1.4fr;
  gap: 6mm;
  font-size: 8pt;
  color: #767676;
  line-height: 1.5;
}
.footer-legal { text-align: right; }

/* Nothing but the document goes on paper. */
@media print {
  .no-print { display: none !important; }
}
`;
