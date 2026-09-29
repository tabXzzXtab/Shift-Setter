#!/usr/bin/env node
/**
 * Analytics, recorded silently and read only by the operator.
 *
 * What it proves:
 *
 *   - a worker's session files screen_enter / screen_exit / tap rows, batched,
 *     and every batch is accepted (201)
 *   - the rows are what the design says: the right screens and role, a
 *     duration on every exit, an element that is a kind and never text, and
 *     no query string in a screen
 *   - closing the page still delivers its last exit (fetch keepalive)
 *   - an automated browser that has not opted in sends nothing at all -- which
 *     is what keeps every other walkthrough out of the numbers
 *   - a client admin opening /super/analytics is told it is not theirs, and
 *     the aggregate function refuses them
 *   - with OPERATOR_EMAIL / OPERATOR_PASSWORD set, the operator sees this
 *     run's screen in the table and a heatmap. Without them that part is
 *     skipped and says so: the aggregates themselves are proven by test:db.
 *
 * The rows this run writes land in a real company's analytics, so they are
 * deleted at the end -- by the visit ids this run captured from its own
 * requests, and nothing else.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });

let n = 0;
const log = (m) => console.log(`  ${String(++n).padStart(2, "0")}. ${m}`);
const visits = new Set();
const fail = (m) => { console.error(`\nFAILED: ${m}`); cleanup(); process.exit(1); };
const shot = (page, name) => page.screenshot({ path: path.join(ART, `analys-${name}.png`), fullPage: true });

function sql(query, { commit = false } = {}) {
  const args = ["scripts/sql.mjs", ...(commit ? [] : ["--rollback"]), "--query", query];
  return execFileSync(process.execPath, args, { encoding: "utf8" });
}
const uuidList = () => [...visits].filter((v) => /^[0-9a-f-]{36}$/.test(v)).map((v) => `'${v}'`).join(",");

function cleanup() {
  if (!visits.size) return;
  try {
    sql(`delete from public.analytics_event where visit_id in (${uuidList()})`, { commit: true });
    console.log(`  (removed this run's rows: ${visits.size} visits)`);
  } catch (e) {
    console.error(`LEFT BEHIND: analytics rows for visits ${uuidList()} -- ${e.message.split("\n")[0]}`);
  }
}

async function newContext(browser, optIn) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  if (optIn) await ctx.addInitScript(() => { try { localStorage.setItem("byggkoll.analytics-test", "1"); } catch { /* */ } });
  return ctx;
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await page.locator('label:has(> span:text-is("E-post")) input').fill(email);
  await page.locator('label:has(> span:text-is("Lösenord")) input').fill(password);
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
  await page.waitForLoadState("networkidle");
}

async function tap(page, locator) {
  await locator.first().waitFor({ state: "visible", timeout: 20000 });
  await locator.first().scrollIntoViewIfNeeded();
  const b = await locator.first().boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

/** Every batch this page sends to the table, and what came back. */
function watch(page) {
  const sent = [];
  page.on("request", (r) => {
    if (!r.url().includes("/rest/v1/analytics_event") || r.method() !== "POST") return;
    try {
      const rows = JSON.parse(r.postData() ?? "[]");
      for (const row of rows) visits.add(row.visit_id);
      sent.push({ rows, status: null, req: r });
    } catch { /* */ }
  });
  page.on("response", (res) => {
    const s = sent.find((x) => x.req === res.request());
    if (s) s.status = res.status();
  });
  return sent;
}

const browser = await chromium.launch();
console.log(`\nAnalys at ${BASE}\n`);

try {
  // ---- a worker, opted in -------------------------------------------------
  const ctx = await newContext(browser, true);
  const page = await ctx.newPage();
  const sent = watch(page);
  await signIn(page, required("DEMO_WORKER_EMAIL"), required("DEMO_WORKER_PASSWORD"));
  await page.waitForTimeout(1500);
  await tap(page, page.getByRole("link", { name: "Mina Pass" }));
  await page.waitForURL((u) => u.pathname.startsWith("/mina-pass"), { timeout: 20000 });
  await page.waitForTimeout(1500);
  await tap(page, page.getByRole("button", { name: "Kalender", exact: true }));
  await page.waitForTimeout(800);
  await shot(page, "1-mina-pass");
  // The batch goes on the 10 s timer; wait it out rather than force it.
  await page.waitForTimeout(11500);

  if (!sent.length) fail("a worker's session sent no analytics at all");
  const refused = sent.filter((s) => s.status !== 201);
  if (refused.length) fail(`a batch was not accepted: ${refused.map((s) => s.status).join(", ")}`);
  const rows = sent.flatMap((s) => s.rows);
  log(`the session sent ${sent.length} batch(es), ${rows.length} rows, all 201`);

  const kinds = (k, screen) => rows.filter((r) => r.kind === k && (!screen || r.screen === screen));
  if (!kinds("screen_enter", "/").length || !kinds("screen_enter", "/mina-pass").length) {
    fail(`missing screen_enter for / or /mina-pass: ${JSON.stringify(rows.map((r) => [r.kind, r.screen]))}`);
  }
  const exitHome = kinds("screen_exit", "/")[0];
  if (!exitHome || !(exitHome.duration_ms > 0)) fail("leaving / filed no exit with a duration");
  const taps = kinds("tap");
  if (taps.length < 2) fail(`expected at least two taps, got ${taps.length}`);
  const bad = taps.filter((t) => !/^[a-z0-9:._-]{1,80}$/.test(t.element));
  if (bad.length) fail(`an element carried text: ${JSON.stringify(bad.map((t) => t.element))}`);
  if (rows.some((r) => r.screen.includes("?") || r.role !== "arbetare")) fail("a row carried a query string or the wrong role");
  if (rows.some((r) => "account_id" in r || "tenant_id" in r)) fail("a row named its account or tenant from the client");
  log(`/ exited after ${exitHome.duration_ms} ms; taps recorded as ${[...new Set(taps.map((t) => t.element))].join(", ")} -- no text, no ids`);

  // And the database holds them, with the tenant it chose, not one we sent.
  const out = sql(`select count(*)::int as n from public.analytics_event where visit_id in (${uuidList()})`);
  const held = Number(/│\s*0\s*│\s*(\d+)\s*│/.exec(out)?.[1]);
  if (held !== rows.length) fail(`the table holds ${held} of this run's ${rows.length} rows`);
  log(`the table holds all ${held}`);

  // ---- closing the page delivers the last exit ----------------------------
  const before = rows.length;
  const openVisit = kinds("screen_enter", "/mina-pass").at(-1).visit_id;
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 2500));
  const closed = sql(`select count(*)::int as n from public.analytics_event
                       where visit_id = '${openVisit}' and kind = 'screen_exit'`);
  if (Number(/│\s*0\s*│\s*(\d+)\s*│/.exec(closed)?.[1]) !== 1) {
    fail("closing the page lost the last screen_exit -- the keepalive send did not arrive");
  }
  log(`closing the page still filed /mina-pass's exit (keepalive), after ${before} rows by batch`);
  await ctx.close();

  // ---- an automated browser that did not opt in ----------------------------
  const quiet = await newContext(browser, false);
  const qp = await quiet.newPage();
  const qs = watch(qp);
  await signIn(qp, required("DEMO_WORKER_EMAIL"), required("DEMO_WORKER_PASSWORD"));
  await tap(qp, qp.getByRole("link", { name: "Mina Pass" }));
  await qp.waitForTimeout(12000);
  if (qs.length) fail(`an automated browser without the opt-in sent ${qs.length} batch(es)`);
  log("an automated browser without the opt-in sent nothing -- the other walkthroughs stay out");
  await quiet.close();

  // ---- a client admin is not the operator ------------------------------------
  const actx = await newContext(browser, false);
  const ap = await actx.newPage();
  await signIn(ap, required("DEMO_ADMIN_EMAIL"), required("DEMO_ADMIN_PASSWORD"));
  await ap.goto(`${BASE}/super/analytics/`, { waitUntil: "networkidle" });
  await ap.getByText("Den här sidan är för dem som driver ByggKoll.").waitFor({ timeout: 20000 })
    .catch(() => fail("a client admin was not told /super/analytics is not theirs"));
  if (await ap.locator("[data-times]").count()) fail("a client admin was shown analytics rows");
  // The notice is a courtesy; the refusal is the database's. Asked directly,
  // with the admin's own session, the aggregate must be refused.
  const token = await ap.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("shift-setter-auth") ?? "null")?.access_token ?? null; }
    catch { return null; }
  });
  if (!token) fail("could not read the admin's session to ask the database directly");
  const res = await fetch(`${required("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/rpc/analytics_screen_times`, {
    method: "POST",
    headers: {
      apikey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_from: "2000-01-01T00:00:00Z", p_to: "2100-01-01T00:00:00Z" }),
  });
  const body = await res.text();
  if (res.ok || !/only the operator reads analytics/.test(body)) {
    fail(`the aggregate answered a client admin: ${res.status} ${body.slice(0, 120)}`);
  }
  log(`a client admin is told /super/analytics is not theirs; asked directly, the database refuses (${res.status})`);
  await shot(ap, "2-klientadmin");
  await actx.close();

  // ---- the operator ------------------------------------------------------------
  if (process.env.OPERATOR_EMAIL && process.env.OPERATOR_PASSWORD) {
    const octx = await newContext(browser, false);
    const op = await octx.newPage();
    await signIn(op, process.env.OPERATOR_EMAIL, process.env.OPERATOR_PASSWORD);
    await op.goto(`${BASE}/super/analytics/`, { waitUntil: "networkidle" });
    await op.locator('[data-times="/mina-pass|arbetare"]').waitFor({ timeout: 20000 })
      .catch(() => fail("the operator's table has no /mina-pass row for arbetare"));
    await op.locator("[data-heatmap]").waitFor({ timeout: 20000 })
      .catch(() => fail("the operator's page drew no heatmap"));
    await shot(op, "3-operator");
    log("the operator sees /mina-pass for arbetare in the table, and a heatmap");
    await octx.close();
  } else {
    log("SKIPPED: the operator's view -- set OPERATOR_EMAIL / OPERATOR_PASSWORD to drive it");
  }

  console.log("\nANALYS WALKTHROUGH COMPLETE.\n");
} finally {
  cleanup();
  await browser.close();
}
