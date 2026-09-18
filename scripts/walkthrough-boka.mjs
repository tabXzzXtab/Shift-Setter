#!/usr/bin/env node
/**
 * Boka Pass on Öppna Pass, end to end against the real database.
 *
 *   the new subtitle · a pass accept_offer will NOT take, refused in Swedish ·
 *   a pass it will, booked from the list · the tilldelning row that proves it ·
 *   the card gone · the confirmation that clears itself · invariant 2 after.
 *
 * The refusal is half the point: Öppna Pass is not filtered on pass_offer, so
 * it lists shifts accept_offer will refuse -- and what the screen says when
 * that happens is the thing worth asserting.
 *
 * It runs on the STABLE DEMO ACCOUNTS rather than creating its own, and the
 * LEADER creates the project rather than the admin. Both because of where the
 * tenant split currently sits: every admin account is in one tenant and every
 * arbetsledare and arbetare in another, so create-account has no tenant to
 * write and an admin-created project cannot name any of them responsible.
 * Neither is under test here, and neither is worked around in the app.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { connectionString, required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });

const LEADER = {
  email: required("DEMO_LEADER_EMAIL"),
  password: required("DEMO_LEADER_PASSWORD"),
  name: "Lena Ledare",
};
const WORKER = {
  email: required("DEMO_WORKER_EMAIL"),
  password: required("DEMO_WORKER_PASSWORD"),
  name: "Arvid Arbetare",
};
const RUN = Date.now().toString().slice(-6);

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const shot = (page, n) => page.screenshot({ path: path.join(ART, `${n}.png`), fullPage: true });
let page;
async function fail(m) {
  if (page) await shot(page, "FAILED").catch(() => {});
  console.error(`\nFAILED: ${m}`);
  process.exit(1);
}

const field = (p, label) =>
  p.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

async function signIn(p, email, password) {
  await p.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await p.locator("form").waitFor({ timeout: 20000 });
  await field(p, "E-post").fill(email);
  await field(p, "Lösenord").fill(password);
  await p.getByRole("button", { name: "Logga in" }).click();
  await p.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await p.waitForLoadState("networkidle");
}

async function signOut(p) {
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  if (!(await p.getByRole("button", { name: "Logga ut" }).count())) {
    await p.getByRole("button", { name: "Profil", exact: true }).click();
  }
  await p.getByRole("button", { name: "Logga ut" }).click();
  await p.waitForURL(/login/, { timeout: 20000 });
}

/** Read before tapping: the availability gesture is a toggle. */
async function markCannot(p, date) {
  const marked = () => p.locator(`[data-date="${date}"][aria-label*="kan inte"]`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await p.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
    await p.locator(`[data-date="${date}"]`).waitFor({ timeout: 20000 });
    await p.waitForTimeout(800);
    if (await marked().count()) return;
    await p.getByRole("button", { name: "Kan inte", exact: true }).click();
    const cell = p.locator(`[data-date="${date}"]`);
    await cell.scrollIntoViewIfNeeded();
    const b = await cell.boundingBox();
    await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await p.waitForTimeout(2000);
  }
  await fail(`could not mark ${date} as a day they cannot work`);
}

async function makePass(p, project, date, hours) {
  await p.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await p.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  const cell = p.locator(`[data-date="${date}"]`);
  await cell.waitFor({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await p.getByRole("button", { name: "Fortsätt", exact: true }).click();
  await p.getByText("Vad behövs?").waitFor({ timeout: 20000 });
  await field(p, "Projekt").selectOption({ label: project });
  await p.getByLabel("Timmar på rad 1").fill(hours);
  await p.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await p.getByText("Passen är skapade", { exact: false }).first().waitFor({ timeout: 20000 });
}

const db = new pg.Client({
  connectionString: connectionString(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await db.connect();

// RERUNNABLE. A previous run leaves Arvid holding D_TAKE, and invariant 2 then
// hides the whole day from open_pass -- the next run would fail at "not
// offered" for a reason that has nothing to do with the screen. Scoped to this
// worker, these two dates, and projects this script made.
for (const table of ["pass_offer", "tilldelning"]) {
  await db.query(
    `delete from public.${table} x
      using public.worker w, public.pass p, public.project pr
      where x.worker_id = w.id and w.email = $1
        and x.pass_id = p.id and p.project_id = pr.id and pr.name like 'Boka %'`,
    [required("DEMO_WORKER_EMAIL")]);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
page = await ctx.newPage();
page.on("pageerror", (e) => void fail(`page error: ${e.message}`));

const sv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });
const today = sv.format(new Date());
const D_TAKE = sv.format(new Date(Date.now() + 11 * 864e5));
const D_REFUSE = sv.format(new Date(Date.now() + 12 * 864e5));
const ADDRESS = "Stortorget 1, 211 22 Malmö";

console.log(`\nBoka Pass on Öppna Pass at ${BASE}`);
console.log(`  take ${D_TAKE} · refuse ${D_REFUSE}\n`);

try {
  // ---- setup ---------------------------------------------------------------
  //
  // THE LEADER CREATES THE PROJECT, not the admin. Every admin account sits in
  // a different tenant from every arbetsledare and arbetare, so an
  // admin-created project cannot name one of them responsible --
  // project_leader_tenant_matches_account refuses it. That is the tenant split
  // as it stands in this database, not a shortcut: a leader creating their own
  // project is a route the app already has.
  //
  // The can't-work mark goes on FIRST, because the tier walk runs when the
  // pass is created, and it is what keeps D_REFUSE from being offered.
  await signIn(page, WORKER.email, WORKER.password);
  await markCannot(page, D_REFUSE);
  await signOut(page);
  log(`${WORKER.name} cannot work ${D_REFUSE}`);

  await signIn(page, LEADER.email, LEADER.password);
  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const project = `Boka ${RUN}`;
  await field(page, "Projektnamn").fill(project);
  await field(page, "Projektets adress").fill(ADDRESS);
  await field(page, "Beställarens adress").fill("Fakturagatan 9, 111 22 Stockholm");
  await field(page, "Beställarens bolag").fill("Malmö Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Stenläggning");
  await field(page, "Startdatum").fill(today);
  await field(page, "Arbetsledare").selectOption({ label: LEADER.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  log(`project ${project}, led by ${LEADER.name}`);

  await makePass(page, project, D_TAKE, "6");
  await makePass(page, project, D_REFUSE, "6");
  await signOut(page);

  const { rows: passRows } = await db.query(
    `select p.id, p.work_date::text as work_date, p.headcount,
            (select count(*) from public.tilldelning t
              where t.pass_id = p.id and t.released_at is null)::int as taken
       from public.pass p
       join public.project pr on pr.id = p.project_id
      where pr.name = $1 and p.deleted_at is null
      order by p.work_date`, [project]);
  if (passRows.length !== 2) await fail(`expected 2 pass rows, found ${passRows.length}`);
  const takeRow = passRows.find((r) => r.work_date === D_TAKE);
  const refuseRow = passRows.find((r) => r.work_date === D_REFUSE);
  for (const r of [takeRow, refuseRow]) {
    if (r.taken >= r.headcount) {
      await fail(`the ${r.work_date} pass filled itself (${r.taken}/${r.headcount}) -- `
        + "it will not appear in Öppna Pass, so this run proves nothing");
    }
  }

  const { rows: offers } = await db.query(
    `select o.pass_id, o.state::text as state from public.pass_offer o
       join public.worker w on w.id = o.worker_id
      where w.email = $1 and o.pass_id = any($2::uuid[])`,
    [WORKER.email, [takeRow.id, refuseRow.id]]);
  const takeOffer = offers.find((o) => o.pass_id === takeRow.id);
  const refuseOffer = offers.find((o) => o.pass_id === refuseRow.id);
  if (takeOffer?.state !== "offered") {
    await fail(`the ${D_TAKE} pass is ${takeOffer?.state ?? "not offered"} to ${WORKER.name}, expected offered`);
  }
  if (refuseOffer) {
    await fail(`the ${D_REFUSE} pass was offered to ${WORKER.name} after all (${refuseOffer.state})`);
  }
  log(`${D_TAKE} offered to ${WORKER.name}; ${D_REFUSE} never offered -- both still open`);

  // ---- Öppna Pass ----------------------------------------------------------
  await signIn(page, WORKER.email, WORKER.password);
  await page.goto(`${BASE}/oppna-pass/`, { waitUntil: "networkidle" });
  await page.locator(`[data-open-pass="${takeRow.id}"]`).waitFor({ timeout: 20000 });

  const sub = (await page.locator("main p").first().innerText()).trim();
  if (sub !== "Pass som saknar folk. Boka ett pass som passar ditt schema.") {
    await fail(`the subtitle reads "${sub}"`);
  }
  if (!(await page.locator(`[data-open-pass="${refuseRow.id}"]`).count())) {
    await fail("the never-offered pass is missing from Öppna Pass -- the list should carry it");
  }
  log("both passes listed, under the new subtitle");
  await shot(page, "boka-1-lista");

  // ---- the refusal ---------------------------------------------------------
  await page.locator(`[data-open-pass="${refuseRow.id}"]`)
    .getByRole("button", { name: "Boka Pass", exact: true }).click();
  const stop = page.locator('[data-toast="stop"]');
  await stop.waitFor({ timeout: 20000 });
  const stopText = (await stop.innerText()).trim();
  if (stopText !== "Passet erbjuds inte längre till dig.") {
    await fail(`the refusal reads "${stopText}" -- fel.ts says "Passet erbjuds inte längre till dig."`);
  }
  if (!(await page.locator(`[data-open-pass="${refuseRow.id}"]`).count())) {
    await fail("a refused booking removed the card anyway");
  }
  const { rows: noRow } = await db.query(
    `select count(*)::int as n from public.tilldelning t
       join public.worker w on w.id = t.worker_id
      where w.email = $1 and t.pass_id = $2`, [WORKER.email, refuseRow.id]);
  if (noRow[0].n !== 0) await fail(`a refused booking still wrote ${noRow[0].n} tilldelning row(s)`);
  log("refused in Swedish, card kept, nothing written");
  await shot(page, "boka-2-refuserad");

  // ---- the booking ---------------------------------------------------------
  await page.locator(`[data-open-pass="${takeRow.id}"]`)
    .getByRole("button", { name: "Boka Pass", exact: true }).click();
  const live = page.locator('[data-toast="live"]');
  await live.waitFor({ timeout: 20000 });
  const liveText = (await live.innerText()).trim();
  if (liveText !== "Passet är ditt.") await fail(`the confirmation reads "${liveText}"`);

  await page.locator(`[data-open-pass="${takeRow.id}"]`)
    .waitFor({ state: "detached", timeout: 20000 });
  log(`Boka Pass on ${D_TAKE}: confirmed, card gone`);
  await shot(page, "boka-3-bokad");

  const { rows: mine } = await db.query(
    `select t.source::text as source, t.work_date::text as work_date, t.released_at
       from public.tilldelning t
       join public.worker w on w.id = t.worker_id
      where w.email = $1 and t.pass_id = $2`, [WORKER.email, takeRow.id]);
  if (mine.length !== 1) await fail(`expected exactly 1 tilldelning row, found ${mine.length}`);
  if (mine[0].source !== "oppen") await fail(`source is ${mine[0].source}, accept_offer writes 'oppen'`);
  if (mine[0].work_date !== D_TAKE) await fail(`work_date is ${mine[0].work_date}, expected ${D_TAKE}`);
  if (mine[0].released_at !== null) await fail("the new assignment is already released");

  const { rows: acc } = await db.query(
    `select o.state::text as state from public.pass_offer o
       join public.worker w on w.id = o.worker_id
      where w.email = $1 and o.pass_id = $2`, [WORKER.email, takeRow.id]);
  if (acc[0].state !== "accepted") await fail(`the offer is ${acc[0].state}, expected accepted`);
  log("the database agrees: one tilldelning row, source oppen, offer accepted");

  // The confirmation is brief; the refusal was not. Both are asserted.
  await page.waitForTimeout(3200);
  if (await page.locator('[data-toast="live"]').count()) {
    await fail("the confirmation toast never cleared itself");
  }
  log("the confirmation clears itself; the refusal had not");

  // ---- invariant 2, through the view --------------------------------------
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const { rows: sameDay } = await db.query(
    `select p.id from public.pass p
      where p.work_date = $1::date and p.deleted_at is null`, [D_TAKE]);
  for (const r of sameDay) {
    if (await page.locator(`[data-open-pass="${r.id}"]`).count()) {
      await fail(`a ${D_TAKE} opening is still listed after ${WORKER.name} took that day`);
    }
  }
  log(`no ${D_TAKE} opening survives the list -- invariant 2, from the view`);

  console.log("\nBOKA PASS COMPLETE.\n");
} finally {
  await browser.close();
  await db.end();
}
