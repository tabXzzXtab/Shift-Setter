#!/usr/bin/env node
/**
 * Notiser: the bell with its count, the list, a tap, Markera alla som lästa.
 *
 * A FRESH arbetare and a fresh arbetsledare, made through Ny arbetare, so the
 * counts are this run's and nobody's real notifications are marked read --
 * reading cannot be undone (app.tg_notification_only_read). Three
 * notifications for the worker and one for the leader are written straight
 * into the table, the way the system's own triggers write them.
 *
 *   - the arbetare startsida draws NO notice cards any more, and the bell
 *     says 3;
 *   - /notiser says "3 olästa" and words each row from spec 6b with the
 *     project's NAME and a Swedish date -- never "Du har en ny notis.";
 *   - tapping one marks that one read in the database and opens Mina pass;
 *   - Markera alla som lästa leaves the worker with none unread, and the
 *     bell with no count;
 *   - an arbetsledare has the bell too, and sees "Pass skickat tillbaka".
 */
import { chromium, devices } from "playwright";
import pg from "pg";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { connectionString, required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });
const ADMIN = { email: required("DEMO_ADMIN_EMAIL"), password: required("DEMO_ADMIN_PASSWORD") };
const RUN = Date.now().toString().slice(-6);

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };
const shot = (page, n) => page.screenshot({ path: path.join(ART, `${n}.png`), fullPage: true });
const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await field(page, "E-post").fill(email);
  await field(page, "Lösenord").fill(password);
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.waitForLoadState("networkidle");
}

async function signOut(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut" }).click();
  await page.waitForURL(/login/, { timeout: 20000 });
}

async function createPerson(page, name, email, role) {
  await page.goto(`${BASE}/arbetare/ny/`, { waitUntil: "networkidle" });
  await field(page, "Namn").fill(name);
  await field(page, "E-post").fill(email);
  await field(page, "Roll").selectOption(role);
  await page.getByRole("button", { name: /Kopiera inloggning/ }).click();
  const password = (await page.locator("[data-password]").first().innerText()).trim();
  if (!password) fail(`no password for ${name}`);
  await page.getByRole("button", { name: /^Skapa (arbetare|arbetsledare|administratör)$/ }).click();
  await page.getByText("Klar", { exact: false }).first().waitFor({ timeout: 20000 });
  return { email, password, name };
}

const bell = (page) => page.locator("[data-notis-bell]");

const db = new pg.Client({ connectionString: connectionString() });
await db.connect();
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm" });
const page = await ctx.newPage();
console.log(`\nNotiser at ${BASE}\n`);

try {
  await signIn(page, ADMIN.email, ADMIN.password);
  const W = await createPerson(page, `Nora ${RUN}`, `notis.w.${RUN}@bella.test`, "arbetare");
  const L = await createPerson(page, `Leo ${RUN}`, `notis.l.${RUN}@bella.test`, "arbetsledare");
  await signOut(page);

  const accountOf = async (email) =>
    (await db.query("select id from auth.users where lower(email) = lower($1)", [email])).rows[0].id;
  const wId = await accountOf(W.email);
  const lId = await accountOf(L.email);
  const { rows: [proj] } = await db.query(
    `select p.id, p.name from public.project p
       join public.account a on a.tenant_id = p.tenant_id
      where a.id = $1 and p.deleted_at is null order by p.created_at limit 1`, [wId]);
  if (!proj) fail("the demo company has no project to name in a notification");

  const ins = async (account, kind, date) => (await db.query(
    `insert into public.notification (account_id, kind, payload)
     values ($1, $2, jsonb_build_object('project_id', $3::uuid, 'work_date', $4::date, 'pass_id', gen_random_uuid()))
     returning id`, [account, kind, proj.id, date])).rows[0].id;
  const deleted = await ins(wId, "shift_deleted", "2026-11-12");
  await ins(wId, "pass_closed", "2026-11-13");
  await ins(wId, "shift_offered", "2026-11-14");
  await ins(lId, "day_unconfirmed", "2026-11-10");
  log(`${W.name} has 3 unread notifications and ${L.name} 1, about "${proj.name}"`);

  // ---- the startsida: a bell with a count, no cards -------------------------
  await signIn(page, W.email, W.password);
  await bell(page).waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelector("[data-notis-bell]")?.getAttribute("data-notis-bell") === "3",
    null, { timeout: 15000 }).catch(() => {});
  if ((await bell(page).getAttribute("data-notis-bell")) !== "3") {
    await shot(page, "FAILED");
    fail(`the bell says ${await bell(page).getAttribute("data-notis-bell")}, not 3`);
  }
  for (const gone of ["Du har en ny notis", "Okej"]) {
    if (await page.getByText(gone, { exact: true }).count()) {
      await shot(page, "FAILED");
      fail(`the startsida still draws a notice card ("${gone}")`);
    }
  }
  await shot(page, "no1-klocka");
  log("the arbetare startsida has a bell that says 3, and no notice cards");

  // ---- the list ---------------------------------------------------------------
  await bell(page).click();
  await page.waitForURL(/\/notiser/, { timeout: 15000 });
  await page.getByText("3 olästa").waitFor({ timeout: 15000 });
  const text = await page.locator("main").innerText();
  for (const want of ["Pass inställt", `Ditt pass 12 november på ${proj.name} är borttaget`,
                      "Pass stängt", "Nytt pass", `Du har fått ett pass 14 november på ${proj.name}`]) {
    if (!text.includes(want)) { await shot(page, "FAILED"); fail(`/notiser does not say "${want}"`); }
  }
  if (/Du har en ny notis|2026-11-1/.test(text)) fail("/notiser falls back to a generic line or a raw date");
  if ((await page.locator('[data-unread="1"]').count()) !== 3) fail("not three rows marked unread");
  await shot(page, "no2-lista");
  log('/notiser: "3 olästa", each row worded from spec 6b with the project and a Swedish date');

  // ---- a tap marks that one, and opens what it is about ----------------------
  await page.locator('[data-notis="shift_deleted"]').click();
  await page.waitForURL(/\/mina-pass/, { timeout: 15000 });
  const read = async (id) => (await db.query("select read_at from public.notification where id = $1", [id])).rows[0].read_at;
  if (!(await read(deleted))) fail("tapping the notification did not mark it read");
  const left = (await db.query("select count(*)::int n from public.notification where account_id = $1 and read_at is null", [wId])).rows[0].n;
  if (left !== 2) fail(`after one tap ${left} are unread, not 2`);
  log("tapping one marks that one read in the database and opens Mina pass");

  // ---- Markera alla som lästa ---------------------------------------------------
  await page.goto(`${BASE}/notiser/`, { waitUntil: "networkidle" });
  await page.getByText("2 olästa").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Markera alla som lästa" }).click();
  await page.getByText("Allt är läst.").waitFor({ timeout: 15000 });
  const none = (await db.query("select count(*)::int n from public.notification where account_id = $1 and read_at is null", [wId])).rows[0].n;
  if (none !== 0) fail(`Markera alla som lästa left ${none} unread`);
  if (await page.getByRole("button", { name: "Markera alla som lästa" }).count()) fail("the button stays with nothing unread");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await bell(page).waitFor({ timeout: 15000 });
  if ((await bell(page).getAttribute("data-notis-bell")) !== "0") fail("the bell still carries a count");
  await shot(page, "no3-last");
  log("Markera alla som lästa: none unread in the database, and the bell has no count");
  await signOut(page);

  // ---- an arbetsledare has it too ---------------------------------------------
  await signIn(page, L.email, L.password);
  await bell(page).waitFor({ timeout: 20000 });
  await bell(page).click();
  await page.getByText("Pass skickat tillbaka").waitFor({ timeout: 15000 });
  await shot(page, "no4-ledare");
  log("an arbetsledare has the bell, and reads their own notification on /notiser");

  console.log("\nNOTISER COMPLETE.\n");
} finally {
  await browser.close();
  await db.end();
}
