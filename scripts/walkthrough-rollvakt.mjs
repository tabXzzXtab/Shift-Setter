#!/usr/bin/env node
/**
 * The route guard: every screen that is not a role's sends that role home.
 *
 * An arbetare types every admin and staff address; an arbetsledare types every
 * admin address. Each must end on "/" -- and the guarded screen's own title
 * must never have been drawn on the way, because a form that flashes up and
 * vanishes still told the worker it was there. Then the other direction: the
 * roles that ARE allowed stay put, so a guard that sends everybody home cannot
 * pass this.
 *
 * Writes nothing. Uses the stable demo logins from .env.local.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });

const ADMIN_ONLY = ["/arbetsdagbok/", "/granska/", "/snabb/", "/installningar/",
  "/arbetare/ny/", "/projekt/redigera/", "/stall-in/"];
const STAFF = ["/kalender/", "/pass/", "/pass/ny/", "/projekt/", "/projekt/ny/",
  "/bekrafta/", "/historik/", "/foretag/", "/dag/ny/"];

const LOGINS = {
  admin: [required("DEMO_ADMIN_EMAIL"), required("DEMO_ADMIN_PASSWORD")],
  arbetsledare: [required("DEMO_LEADER_EMAIL"), required("DEMO_LEADER_PASSWORD")],
  arbetare: [required("DEMO_WORKER_EMAIL"), required("DEMO_WORKER_PASSWORD")],
};

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };

const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

async function signedIn(browser, role) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  const page = await ctx.newPage();
  // Every <h1> any document draws, with the path it was drawn on, recorded
  // from the first byte. A fresh document starts a fresh list; the guard's
  // router.replace is not a new document, so the list survives the redirect.
  await page.addInitScript(() => {
    window.__h1s = [];
    new MutationObserver(() => {
      for (const h of document.querySelectorAll("h1")) {
        const t = h.textContent?.trim();
        const k = `${location.pathname}|${t}`;
        if (t && !window.__h1s.includes(k)) window.__h1s.push(k);
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  const [email, password] = LOGINS[role];
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await field(page, "E-post").fill(email);
  await field(page, "Lösenord").fill(password);
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  return page;
}

const here = (page) => new URL(page.url()).pathname.replace(/\/+$/, "") || "/";

/**
 * Open `route` and require it to end on "/" without the screen ever drawing a
 * heading. Every <h1> that appears is recorded from the first byte, so a flash
 * of the refused screen is caught even though it is gone by the time we look.
 */
async function sentHome(page, route, role) {
  await page.goto(`${BASE}${route}`, { waitUntil: "commit" });
  try {
    await page.waitForURL((u) => (u.pathname.replace(/\/+$/, "") || "/") === "/", { timeout: 15000 });
  } catch {
    await page.screenshot({ path: path.join(ART, "FAILED.png"), fullPage: true });
    fail(`${role} on ${route} was not sent home -- ended on ${here(page)}`);
  }
  const seen = await page.evaluate(() => window.__h1s);
  const onRoute = seen.filter((s) => s.startsWith(route.replace(/\/+$/, "")));
  if (onRoute.length) fail(`${role} on ${route} saw the screen before being sent home: ${onRoute.join(", ")}`);
}

async function stays(page, route, role) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const want = route.replace(/\/+$/, "");
  if (here(page) !== want) fail(`${role} may open ${route} but was moved to ${here(page)}`);
}

console.log(`\nRollvakt at ${BASE}\n`);
const browser = await chromium.launch();

const worker = await signedIn(browser, "arbetare");
for (const r of [...ADMIN_ONLY, ...STAFF]) {
  await sentHome(worker, r, "arbetare");
  log(`arbetare on ${r} -> sent home, nothing drawn`);
}
await stays(worker, "/mina-pass/", "arbetare");
log("arbetare stays on /mina-pass/ (their own screen)");

const leader = await signedIn(browser, "arbetsledare");
for (const r of ADMIN_ONLY) {
  await sentHome(leader, r, "arbetsledare");
  log(`arbetsledare on ${r} -> sent home, nothing drawn`);
}
for (const r of ["/kalender/", "/pass/ny/", "/foretag/", "/bekrafta/"]) {
  await stays(leader, r, "arbetsledare");
  log(`arbetsledare stays on ${r}`);
}

const admin = await signedIn(browser, "admin");
for (const r of ["/arbetsdagbok/", "/installningar/", "/snabb/", "/kalender/"]) {
  await stays(admin, r, "admin");
  log(`admin stays on ${r}`);
}

await browser.close();
console.log("\nOK: every refused route sent its role home; every allowed one stayed.\n");
