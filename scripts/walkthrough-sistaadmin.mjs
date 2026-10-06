#!/usr/bin/env node
/**
 * Invariant 11 on the account screen: the last admin's demotion is refused,
 * and the screen SAYS so -- under the Roll selector, where the press was, and
 * still there after Spara says "Sparat." about the profile.
 *
 * It used to land in the notice at the top of the page, out of sight from the
 * Roll card, and Spara cleared it; a refused demotion read as a saved one.
 *
 * SAFETY: this presses a real demotion. It checks first that the demo admin is
 * the ONLY active admin of their company -- with a second one the database
 * would rightly let it through and this script would demote a real account --
 * and refuses to run otherwise. Afterwards it reads the role back from the
 * database.
 */
import { chromium, devices } from "playwright";
import pg from "pg";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { connectionString, required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });
const EMAIL = required("DEMO_ADMIN_EMAIL");
const PASSWORD = required("DEMO_ADMIN_PASSWORD");
const SENTENCE = "Det går inte att ta bort den sista administratören.";

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = async (m, page) => {
  if (page) await page.screenshot({ path: path.join(ART, "FAILED.png"), fullPage: true });
  console.error(`\nFAILED: ${m}`);
  process.exit(1);
};

const db = new pg.Client({ connectionString: connectionString() });
await db.connect();
const roleOf = async () =>
  (await db.query("select a.role from public.account a join auth.users u on u.id = a.id where lower(u.email) = lower($1)", [EMAIL])).rows[0]?.role;
const { rows: [{ admins }] } = await db.query(
  `select count(*)::int as admins from public.account a
    where a.tenant_id = (select a2.tenant_id from public.account a2 join auth.users u on u.id = a2.id where lower(u.email) = lower($1))
      and a.role = 'admin' and a.active and a.deleted_at is null`, [EMAIL]);
if (admins !== 1) {
  await db.end();
  await fail(`the demo admin's company has ${admins} active admins, not 1 -- the demotion would go through. Not running.`);
}
if ((await roleOf()) !== "admin") await fail("the demo admin is not an admin to begin with");

console.log(`\nSista administratören at ${BASE}\n`);
log("the demo admin is the only active admin of their company");

const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm" })).newPage();
const field = (label) => page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
await field("E-post").fill(EMAIL);
await field("Lösenord").fill(PASSWORD);
await page.getByRole("button", { name: "Logga in" }).click();
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
await page.goto(`${BASE}/konto/`, { waitUntil: "networkidle" });

const roll = field("Roll");
await roll.waitFor({ timeout: 20000 });
await roll.selectOption("arbetare");
const under = page.locator("[data-roll-fel]");
try {
  await under.getByText(SENTENCE).waitFor({ timeout: 15000 });
} catch {
  await fail("the refused demotion said nothing under the Roll selector", page);
}
if (/last active admin|demoted/i.test(await page.locator("body").innerText())) {
  await fail("the raw English refusal reached the screen", page);
}
log(`refused, and said under the selector: "${SENTENCE}"`);

if ((await roll.inputValue()) !== "admin") await fail("the selector shows a role the database refused", page);
if ((await roleOf()) !== "admin") await fail("the database role changed -- invariant 11 did not hold");
log("the selector is back on Admin, and the database still says admin");

// Spara saves the profile and says so -- and the refusal must still be there.
await page.getByRole("button", { name: "Spara", exact: true }).click();
await page.getByText("Sparat.").first().waitFor({ timeout: 15000 });
if (!(await under.getByText(SENTENCE).count())) {
  await fail("Spara cleared the refusal, so the screen now reads as if the demotion was saved", page);
}
await page.screenshot({ path: path.join(ART, "sa1-sista-admin.png"), fullPage: true });
log('after Spara: "Sparat." for the profile, and the refusal still stands under Roll');

await browser.close();
await db.end();
console.log("\nOK: the last admin's demotion is refused, and the screen says so where it happened.\n");
