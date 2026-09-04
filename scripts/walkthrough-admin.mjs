#!/usr/bin/env node
/**
 * Drive the admin's landing page: the three buttons, the menu, the list,
 * Inställningar and the Konton it holds.
 *
 * Every assertion is on something only the destination has. getByText matches
 * substrings, so "Alla Projekt" would also match the menu entry that leads
 * there -- the checks below name headings and roles, not fragments.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000/Shift-Setter";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };
const shot = (page, n) => page.screenshot({ path: path.join(ART, `${n}.png`), fullPage: true });

const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

async function mustSee(page, text, why) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 20000 });
  } catch {
    await shot(page, "FAILED");
    fail(`${why} (never saw "${text}"; see artifacts/FAILED.png)`);
  }
}

/**
 * The landing page after the account has actually arrived.
 *
 * networkidle is not enough: the role is read from the database on every load
 * (never from the token), so the page renders "Laddar…" first and the bar does
 * not exist yet. Asserting there reads an empty screen as a missing button.
 */
async function landed(page) {
  await page.getByRole("button", { name: "Meny", exact: true })
    .waitFor({ timeout: 30000 });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

console.log(`\nAdmin landing page at ${BASE}\n`);

try {
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await page.locator("form").waitFor({ timeout: 20000 });
  await field(page, "E-post").fill(required("WALKTHROUGH_ADMIN_EMAIL"));
  await field(page, "Lösenord").fill(required("WALKTHROUGH_ADMIN_PASSWORD"));
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await landed(page);
  await shot(page, "a1-landning");
  log("signed in as admin; landed on the new page");

  // ---- the top bar ----------------------------------------------------------
  for (const label of ["Meny", "Profil"]) {
    if (!(await page.getByRole("button", { name: label, exact: true }).count())) {
      fail(`the top bar has no ${label} button`);
    }
  }
  log("top bar: hamburger left, profile icon right");

  // ---- the three + buttons --------------------------------------------------
  const ACTIONS = [
    ["Nytt Projekt", "/projekt/ny", "Projektnamn"],
    ["Skapa Pass", "/pass/ny", "Vilka dagar?"],
    ["Snabb Pass", "/snabb", "Snabb Pass"],
  ];
  for (const [label, href, lands] of ACTIONS) {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await landed(page);
    const link = page.getByRole("link", { name: label, exact: true });
    if (!(await link.count())) fail(`no "${label}" action button on the landing page`);
    await link.click();
    await page.waitForURL((u) => u.pathname.includes(href), { timeout: 20000 });
    await mustSee(page, lands, `"${label}" did not land on its screen`);
    log(`+ ${label} -> ${href}`);
  }

  // ---- the hamburger --------------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await landed(page);
  await page.getByRole("button", { name: "Meny", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Meny" });
  await panel.waitFor({ timeout: 20000 });

  const ITEMS = ["Kalender", "Alla Projekt", "Alla Pass", "Inställningar"];
  for (const label of ITEMS) {
    if (!(await panel.getByRole("link", { name: label, exact: true }).count())) {
      await shot(page, "FAILED");
      fail(`the menu has no "${label}"`);
    }
  }
  await shot(page, "a2-meny");
  log(`menu holds ${ITEMS.join(", ")}`);

  // Tapping outside closes it.
  await page.getByRole("button", { name: "Stäng", exact: true }).click();
  await panel.waitFor({ state: "detached", timeout: 20000 });
  log("tapping the darkened background closes the menu");

  // ---- Alla Projekt on the landing page ------------------------------------
  await page.getByText("Alla Projekt", { exact: true }).first().waitFor({ timeout: 20000 });
  // Two attribute matches rather than one substring: trailingSlash is on, so
  // the href is /arbetsdagbok/?projekt=, and a selector spelling it the other
  // way finds nothing and reads as "there are no projects".
  const rows = page.locator('a[href*="arbetsdagbok"][href*="projekt="]');
  const n = await rows.count();
  if (n === 0) fail("the landing page lists no projects at all");
  const first = await rows.first().innerText();
  if (!/\d/.test(first) || !/\bh\b/.test(first)) {
    fail(`a project row shows no hours: ${JSON.stringify(first)}`);
  }
  log(`Alla Projekt: ${n} rows, first reads ${JSON.stringify(first.replace(/\n/g, " | "))}`);

  // ---- Inställningar and the Konton -----------------------------------------
  await page.getByRole("button", { name: "Meny", exact: true }).click();
  await page.getByRole("link", { name: "Inställningar", exact: true }).click();
  await page.waitForURL((u) => u.pathname.includes("/installningar"), { timeout: 20000 });
  await mustSee(page, "Konton", "Inställningar has no Konton list");

  if (!(await page.getByRole("link", { name: "Tillverka Konto", exact: true }).count())) {
    fail("Tillverka Konto is not at the top of Inställningar");
  }

  const konton = page.locator("section.border-2");
  const k = await konton.count();
  if (k === 0) fail("the Konton list is empty -- it must at least hold the admin signed in");
  const one = await konton.first().innerText();
  if (!/@/.test(one)) fail(`a Konto row shows no email: ${JSON.stringify(one)}`);
  if (!/(Admin|Arbetsledare|Arbetare)/.test(one)) fail(`a Konto row shows no role: ${one}`);
  if (!/(Aktiv|Pausad)/.test(one)) fail(`a Konto row shows no active state: ${one}`);
  await shot(page, "a3-installningar");
  log(`Konton: ${k} accounts, first reads ${JSON.stringify(one.split("\n").slice(0, 3).join(" | "))}`);

  // Each row offers the three things it should.
  for (const label of ["Pausa kontot", "Ändra konto", "Ändra profil"]) {
    if (!(await konton.first().getByText(label, { exact: true }).count())) {
      fail(`a Konto row has no "${label}"`);
    }
  }
  log("each account offers role, pause, Ändra konto and Ändra profil");

  // ---- the profile icon -----------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await landed(page);
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  const pop = page.getByRole("dialog", { name: "Profil" });
  await pop.waitFor({ timeout: 20000 });
  for (const label of ["Konto", "Profil"]) {
    if (!(await pop.getByRole("link", { name: label, exact: true }).count())) {
      await shot(page, "FAILED");
      fail(`the profile popup has no "${label}" button`);
    }
  }
  await shot(page, "a4-profil-popup");
  log("profile icon opens Konto and Profil");

  await pop.getByRole("link", { name: "Profil", exact: true }).click();
  await page.waitForURL((u) => u.pathname.includes("/profil"), { timeout: 20000 });
  await mustSee(page, "Har du företag?", "the Profil form has no company toggle");
  await mustSee(page, "Clearingnummer", "the Profil form is missing its bank fields");
  await shot(page, "a5-profil");
  log("Profil shows the personal fields and the Har du företag? toggle");

  console.log("\nADMIN LANDING PAGE COMPLETE.\n");
} finally {
  await browser.close();
}
