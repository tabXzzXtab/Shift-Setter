const fs = require('fs');
const path = require('path');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(str) {
  return escapeHtml(str).replace(/\n/g, '<br>');
}

function loadCompany() {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'config', 'company.json'), 'utf-8');
  return JSON.parse(raw);
}

function getLogoHtml() {
  const logoPath = path.join(__dirname, '..', 'assets', 'logo.png');
  if (fs.existsSync(logoPath)) {
    const data = fs.readFileSync(logoPath).toString('base64');
    return `<img class="logo-img" src="data:image/png;base64,${data}" alt="Logo">`;
  }
  return `<div class="logo-placeholder">LOGO</div>`;
}

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseHours(value) {
  if (!value) return 0;
  const normalized = String(value).trim().replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

function sumOrdinarieTid(days) {
  let total = 0;
  (days || []).forEach((day) => {
    (day.rows || []).forEach((row) => {
      total += parseHours(row.passTyp1);
    });
  });
  const rounded = Math.round(total * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  return `${formatted}h`;
}

function buildCoverPage(payload) {
  const cover = payload.cover || {};
  const timestamp = formatTimestamp(new Date());
  const total = sumOrdinarieTid(payload.days);

  const metaLines = [];
  if (cover.adressChecked && cover.adress) {
    metaLines.push(`<div class="cover-line"><span class="cv-bold">Adress:</span> ${nl2br(cover.adress)}</div>`);
  }
  if (cover.bolagChecked && cover.bolag) {
    metaLines.push(`<div class="cover-line"><span class="cv-bold">Bolag:</span> ${escapeHtml(cover.bolag)}</div>`);
  }
  if (cover.orgnrChecked && cover.orgnr) {
    metaLines.push(`<div class="cover-line"><span class="cv-bold">Org nummer:</span> ${escapeHtml(cover.orgnr)}</div>`);
  }

  return `
    <section class="cover-page">
      <div class="header">
        ${getLogoHtml()}
        <div class="title">Arbetsdagbok</div>
      </div>

      <div class="cover-meta">
        <div class="cover-line"><span class="cv-bold">Skapad:</span> ${timestamp}</div>
        <div class="cover-line cv-bold">Beställare</div>
        ${metaLines.join('\n        ')}
      </div>

      <hr class="cover-divider">

      <div class="cover-line cover-project"><span class="cv-bold">Project:</span> ${escapeHtml(cover.project || '')}</div>
      <div class="cover-line cv-bold cover-hours">Ordinarie tid: ${total}</div>

      <hr class="cover-divider">

      <div class="cover-approval">
        <div class="cv-heading">GODKÄND AV</div>
        <div class="cover-signline"><span class="cv-bold">Ort &amp; datum:</span><span class="cv-blank"></span></div>
        <div class="cover-signline"><span class="cv-bold">Signatur:</span><span class="cv-blank"></span></div>
      </div>
    </section>`;
}

function buildDayBlock(day) {
  const rows = (day.rows || []).map(r => `
        <div class="row">
          <div class="cell">${escapeHtml(r.arbetare)}</div>
          <div class="cell">${escapeHtml(r.passTyp1)}</div>
          <div class="cell">${escapeHtml(r.passTyp2)}</div>
          <div class="cell cell-project">${escapeHtml(r.project)}</div>
        </div>`).join('');

  return `
    <section class="day-block">
      <div class="date-heading">${escapeHtml(day.date || '20XX-XX-XX')}</div>
      <div class="table">
        <div class="row row-head">
          <div class="cell">Arbetare</div>
          <div class="cell">Pass Timmar</div>
          <div class="cell">Pass Tider</div>
          <div class="cell cell-project">Vad Vi Gjorde</div>
        </div>
        <div class="rows-list">${rows}
        </div>
      </div>
    </section>`;
}

function buildDocumentHtml(payload) {
  const company = loadCompany();
  const coverHtml = buildCoverPage(payload);
  const days = (payload.days || []).map(buildDayBlock).join('');
  const address = (company.postadress || []).map(escapeHtml).join('<br>');

  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<title>Arbetsdagbok</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    padding: 20mm 18mm 30mm 18mm;
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #1a1a1a;
    font-size: 10.5pt;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14mm;
  }
  .logo-img { height: 24mm; width: 24mm; object-fit: contain; }
  .logo-placeholder {
    height: 16mm;
    width: 40mm;
    border: 1px dashed #c7c7c7;
    border-radius: 2mm;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #9a9a9a;
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 1px;
  }
  .title { font-size: 19pt; font-weight: 700; color: #111; letter-spacing: 0.2px; }

  /* Cover page (page 1 only) */
  .cover-page {
    display: flex;
    flex-direction: column;
    min-height: 100%;
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
  .cover-divider {
    border: none;
    border-top: 1.25px solid #111;
    margin: 10mm 0;
  }
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
  .row {
    display: grid;
    grid-template-columns: 1.1fr 1fr 1.3fr 1.6fr;
  }
  .row-head { background: #FBEFD8; }
  .row-head .cell { font-weight: 700; font-size: 9pt; color: #303c54; padding: 3mm 4mm; }
  .rows-list .row:nth-child(odd) { background: #FDF9F1; }
  .cell { padding: 3mm 4mm; font-size: 9.5pt; }

  .footer {
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
</style>
</head>
<body>
  ${coverHtml}

  <div class="header">
    ${getLogoHtml()}
    <div class="title">Arbetsdagbok</div>
  </div>

  ${days}

  <div class="footer">
    <div>
      <div>${escapeHtml(company.postadressLabel)}</div>
      <div>${address}</div>
    </div>
    <div>${escapeHtml(company.telefonLabel)}: ${escapeHtml(company.telefon)}</div>
    <div class="footer-legal">
      <div>${escapeHtml(company.bankgiroLabel)}: ${escapeHtml(company.bankgiro)}</div>
      <div>${escapeHtml(company.orgnote)}</div>
      <div>${escapeHtml(company.orgnrLabel)}: ${escapeHtml(company.orgnr)}</div>
      <div>${escapeHtml(company.momsregLabel)}: ${escapeHtml(company.momsregnr)}</div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { buildDocumentHtml };
