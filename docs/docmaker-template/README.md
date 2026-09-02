# DocMaker — Arbetsdagbok

Offline desktop app for filling in an Arbetsdagbok (work day log) and exporting it as a formatted PDF.
No internet connection is needed to use the app — everything (the form, the PDF engine, the file save
dialog) runs locally on the machine.

## Running it during development

```bash
npm install     # one-time, needs internet
npm start        # opens the app window
```

## Building a standalone offline app (no Node/Electron install needed to run it)

```bash
npm run build:win
```

This produces `dist/win-unpacked/DocMaker.exe` plus a zipped copy of that same folder,
`dist/DocMaker-Offline-Windows.zip`. Copy the zip to any Windows PC (USB stick, network share,
email), unzip it, and double-click `DocMaker.exe` inside — nothing else needs to be installed and
no internet connection is required to run it.

(A true single-file portable `.exe` needs a packaging step that requires Windows "Developer Mode"
to be enabled on the build machine — without it, Windows blocks the symlinks that step creates and
the build falls back to the unpacked folder above, which works identically.)

## How it works

- Fill in the date and add rows (Arbetare / Pass Timmar / Pass Tider / Vad Vi Gjorde) for each work day.
- **+ New row** adds another worker row to the current day.
- **+ New Day** adds a new day section below, with its own date and rows.
- **Generera Document** asks where to save the PDF and what to name it (native Windows save dialog),
  then writes a PDF with every day/row you entered, formatted the same way as it looks on screen,
  with the company footer repeated at the bottom of every page.

## Editing the company footer details

Edit [`config/company.json`](config/company.json) — every value there (address, phone, bankgiro,
F-skatt note, org number, VAT/moms number) is shown at the bottom of every generated page. No code
changes needed.

## Adding a real logo

Drop a `logo.png` file into the [`assets/`](assets) folder (same name, `logo.png`). It will
automatically replace the placeholder diamond, both on screen and in generated PDFs.

## Roadmap

This first version is the offline desktop build. A public/hosted web version is planned as a
follow-up phase, reusing the same PDF template.
