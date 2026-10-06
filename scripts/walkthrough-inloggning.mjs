#!/usr/bin/env node
/**
 * "Kontot är inte aktivt" must not flash up for an active account right after
 * login.
 *
 * The first read of account_directory can go out before the session's token
 * does, and come back 401 or empty. AccountProvider used to take that single
 * answer as final and the startsida drew "Kontot är inte aktivt". It now asks
 * again (0,4 / 0,8 / 1,6 s) before believing an empty answer.
 *
 *   A. the first TWO reads answer 401 (as a token-less request would): the
 *      worker's startsida must arrive, and the message must never be drawn --
 *      not even for a frame (a MutationObserver records it from the first byte);
 *   B. EVERY read answers 401: the retries must end, and the message must
 *      then be drawn -- a real failure still says so.
 *
 * Reads nothing it did not fake and writes nothing. The demo worker login.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });
const EMAIL = required("DEMO_WORKER_EMAIL");
const PASSWORD = required("DEMO_WORKER_PASSWORD");
const MESSAGE = "Kontot är inte aktivt";

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };

async function run(browser, failFirst) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  let faked = 0;
  let armed = false;   // only after the login press: the login page itself reads nothing we fake
  await ctx.route("**/rest/v1/account_directory*", async (route) => {
    if (armed && faked < failFirst) {
      faked++;
      return route.fulfill({ status: 401, contentType: "application/json",
        body: JSON.stringify({ code: "PGRST301", message: "JWT expired" }) });
    }
    return route.continue();
  });
  await ctx.addInitScript((msg) => {
    window.__sawInactive = false;
    new MutationObserver(() => {
      if (document.body?.innerText.includes(msg)) window.__sawInactive = true;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  }, MESSAGE);

  const page = await ctx.newPage();
  const field = (label) => page.locator(`label:has(span:text-is("${label}"))`).locator("input").first();
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await field("E-post").fill(EMAIL);
  await field("Lösenord").fill(PASSWORD);
  armed = true;
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  return { ctx, page, faked: () => faked };
}

console.log(`\nInloggning at ${BASE}\n`);
const browser = await chromium.launch();
try {
  // ---- A. two failed reads, then the real one ------------------------------
  {
    const { ctx, page, faked } = await run(browser, 2);
    try {
      await page.locator('[data-screen="arbetare"]').waitFor({ timeout: 20000 });
    } catch {
      await page.screenshot({ path: path.join(ART, "FAILED.png"), fullPage: true });
      fail("after two failed account reads the worker's startsida never arrived");
    }
    if (faked() !== 2) fail(`expected 2 faked 401s, served ${faked()}`);
    if (await page.evaluate(() => window.__sawInactive)) {
      await page.screenshot({ path: path.join(ART, "FAILED.png"), fullPage: true });
      fail(`"${MESSAGE}" was drawn for an active account whose first reads failed`);
    }
    log(`two 401s on the account read right after login: the startsida arrived, and "${MESSAGE}" was never drawn`);
    await ctx.close();
  }

  // ---- B. every read fails: the message still comes ---------------------------
  {
    const { ctx, page, faked } = await run(browser, 1000);
    try {
      await page.getByText(MESSAGE).waitFor({ timeout: 15000 });
    } catch {
      await page.screenshot({ path: path.join(ART, "FAILED.png"), fullPage: true });
      fail("with every account read failing the retries never ended -- no message was drawn");
    }
    if (faked() !== 4) fail(`expected the read to be tried 4 times, it was tried ${faked()}`);
    log(`every read failing: tried 4 times, then "${MESSAGE}" -- a real failure still says so`);
    await ctx.close();
  }
  console.log("\nINLOGGNING COMPLETE.\n");
} finally {
  await browser.close();
}
