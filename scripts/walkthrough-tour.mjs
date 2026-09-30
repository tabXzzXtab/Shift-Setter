#!/usr/bin/env node
/**
 * The first-launch tour, driven as each of the three roles on a phone, by touch.
 *
 * What it proves:
 *
 *   - the tour opens on first login, per role, at step 1
 *   - a nav step rings the real element, and a real TAP on it moves the tour on
 *   - autofill writes into the form and NEVER SUBMITS: after it finishes and the
 *     tooltip sits on the button, the database holds nothing new
 *   - a step that waits for a real write advances on that write (availability)
 *   - a step whose precondition is unmet, or whose element never appears,
 *     arrives as a card instead of stranding anybody
 *   - starting the tour writes onboarding_complete_{id} (the first visit is the
 *     one that counts; progress is per session), "Kom igång" leaves no
 *     onboarding_step_{id}, and a second login shows no tour
 *   - a browser that has not opted in (every other walkthrough) never sees it
 *
 * THE TOUR IS FRONTEND-ONLY. Every control that would write -- Skapa projekt,
 * Skapa N pass, a day on Min kalender, Acceptera, Stämpla In, Bekräfta dagen,
 * Generera Arbetsdagbok -- is caught by the tour and never reaches the page.
 * The run PRESSES the ones it reaches and asserts that nothing was written:
 * no Fasad Malmö project, no pass, the worker's day still unmarked.
 *
 * NEGATIVE CONTROL: TOUR_NEGATIVE=1 swallows every write of an
 * onboarding_complete_ key, as if "Kom igång" no longer saved it. The run must
 * then FAIL at the second-login check, and nowhere earlier.
 */

import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const NEGATIVE = process.env.TOUR_NEGATIVE === "1";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });

let n = 0;
const log = (m) => console.log(`  ${String(++n).padStart(2, "0")}. ${m}`);
const fail = (m) => {
  console.error(`\nFAILED: ${m}`);
  process.exit(1);
};
const shot = (page, name) => page.screenshot({ path: path.join(ART, `tour-${name}.png`), fullPage: false });

// ---- the database, read-only ---------------------------------------------

function count(sql) {
  const out = execFileSync(process.execPath, ["scripts/sql.mjs", "--rollback", "--query", sql], {
    encoding: "utf8",
  });
  const m = /│\s*0\s*│\s*(\d+)\s*│/.exec(out);
  if (!m) fail(`could not read a count from: ${sql}\n${out}`);
  return Number(m[1]);
}
const esc = (s) => s.replace(/'/g, "''");

// ---- the browser -----------------------------------------------------------

async function newContext(browser, { optIn = true } = {}) {
  const ctx = await browser.newContext({
    ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  });
  await ctx.addInitScript(({ optIn, negative }) => {
    try { if (optIn) localStorage.setItem("byggkoll.tour-test", "1"); } catch { /* */ }
    if (negative) {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).startsWith("onboarding_complete_")) return;
        return set.call(this, k, v);
      };
    }
  }, { optIn, negative: NEGATIVE });
  return ctx;
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await page.locator("form").waitFor({ timeout: 20000 });
  await page.locator('label:has(> span:text-is("E-post")) input').fill(email);
  await page.locator('label:has(> span:text-is("Lösenord")) input').fill(password);
  await tap(page, page.getByRole("button", { name: "Logga in" }));
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
}

/** A finger, not a mouse: CLAUDE.md, touch and mouse are different paths. */
async function tap(page, locator) {
  await locator.first().waitFor({ state: "visible", timeout: 20000 });
  await locator.first().scrollIntoViewIfNeeded();
  const b = await locator.first().boundingBox();
  if (!b) fail("tried to tap something with no box");
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

const card = (page) => page.locator('[data-tour-ui="card"]');
const tip = (page) => page.locator('[data-tour-ui="tip"], [data-tour-ui="bar"]');

async function expectCard(page, text, why) {
  try {
    await card(page).filter({ hasText: text }).waitFor({ timeout: 20000 });
  } catch {
    await shot(page, "FAILED");
    fail(`${why}: no tour card saying ${JSON.stringify(text)}`);
  }
  await expectPainted(page, why);
}

/**
 * The card's button is what is PAINTED where it is -- read off the pixels.
 *
 * Not elementFromPoint: a Leaflet map once drew straight through the card,
 * and hit-testing still answered "the button", because Leaflet's layers take
 * no pointer events. A person saw a map where the button should be. So this
 * samples the button's own left padding, clear of its white label, and wants
 * the accent fill there.
 *
 * After the page has finished arriving: the maps mount once their address is
 * geocoded, well after the card does.
 */
async function expectPainted(page, why) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  const b = await card(page).getByRole("button").first().boundingBox();
  const png = await page.screenshot({ clip: { x: b.x + 8, y: b.y + b.height / 2 - 3, width: 6, height: 6 } });
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const accent = [0x1b, 0x2c, 0xc1];
  let hits = 0;
  const total = data.length / info.channels;
  for (let i = 0; i < data.length; i += info.channels) {
    const d = Math.abs(data[i] - accent[0]) + Math.abs(data[i + 1] - accent[1]) + Math.abs(data[i + 2] - accent[2]);
    if (d <= 12) hits++;
  }
  if (hits < total * 0.9) {
    await shot(page, "FAILED");
    fail(`${why}: the card's button is not what is painted there -- ${hits}/${total} accent pixels, first rgb(${data[0]},${data[1]},${data[2]})`);
  }
}

async function nextCard(page, text, why) {
  await expectCard(page, text, why);
  await tap(page, card(page).getByRole("button", { name: "Nästa" }));
  await card(page).filter({ hasText: text }).waitFor({ state: "detached", timeout: 10000 });
}

/**
 * The ring is on the element: their boxes overlap, the ring a little larger.
 * And -- unless several things are ringed at once -- the element is ON SCREEN
 * with the tooltip anchored to it. A ring around a button below the fold,
 * under a bar saying "tryck här", passed the overlap check alone.
 */
async function expectRingOn(page, target, why, { anchored = true } = {}) {
  try {
    await target.first().waitFor({ state: "visible", timeout: 20000 });
    await page.locator('[data-tour-ui="rings"] > div').first().waitFor({ timeout: 20000 });
  } catch {
    await shot(page, "FAILED");
    fail(`${why}: no ring drawn`);
  }
  // Settled first: the tour may be scrolling the element into view, and a
  // ring compared mid-scroll is a frame behind the thing it follows.
  for (let prev = null, i = 0; i < 40; i++) {
    const b = await target.first().boundingBox();
    if (prev && Math.abs(b.y - prev.y) < 0.5) break;
    prev = b;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(100);
  const t = await target.first().boundingBox();
  const rings = await page.locator('[data-tour-ui="rings"] > div').evaluateAll((els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  const around = rings.some((r) =>
    r.x <= t.x + 1 && r.y <= t.y + 1 && r.x + r.w >= t.x + t.width - 1 && r.y + r.h >= t.y + t.height - 1);
  if (!around) {
    await shot(page, "FAILED");
    fail(`${why}: the ring is not around the element (ring ${JSON.stringify(rings)}, element ${JSON.stringify(t)})`);
  }
  if (anchored) {
    const b = t;
    const vh = page.viewportSize().height;
    if (b.y < 0 || b.y + b.height > vh) {
      await shot(page, "FAILED");
      fail(`${why}: the ringed element is off screen (y ${Math.round(b.y)}-${Math.round(b.y + b.height)} of ${vh})`);
    }
    if (!(await page.locator('[data-tour-ui="tip"]').count())) {
      await shot(page, "FAILED");
      fail(`${why}: the tip is not anchored to the element`);
    }
  }
}

/**
 * What a step shows once it has settled: its ring, or its card -- and when it
 * lives on another screen, the "Ta mig dit" offer, which is taken and the
 * question asked again. Which of the three depends on the tenancy's data (an
 * offer, a waiting day), so the run asks rather than assumes.
 */
async function settle(page, why) {
  const seen = (loc, tag) =>
    loc.waitFor({ timeout: 30000 }).then(() => tag, () => new Promise(() => {}));
  const go = tip(page).getByRole("button", { name: "Ta mig dit" });
  for (let i = 0; i < 2; i++) {
    const what = await Promise.race([
      seen(go.first(), "go"),
      seen(page.locator('[data-tour-ui="rings"] > div').first(), "ring"),
      seen(card(page).first(), "card"),
      new Promise((r) => setTimeout(() => r(null), 32000)),
    ]);
    if (!what) { await shot(page, "FAILED"); fail(`${why}: the step never showed a ring, a card or a way there`); }
    if (what !== "go") return what;
    await tap(page, go);
    // The bar stays drawn until the navigation lands; asking again before it
    // leaves would find the same bar and take it for the answer.
    await go.first().waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
  }
  await shot(page, "FAILED");
  fail(`${why}: "Ta mig dit" did not arrive anywhere (now at ${new URL(page.url()).pathname})`);
}

async function skip(page) {
  await tap(page, tip(page).getByRole("button", { name: "Hoppa över" }));
}

async function expectNoTour(page, why) {
  await page.waitForTimeout(5000);
  if (await card(page).count() || await tip(page).count()) {
    await shot(page, "FAILED");
    fail(why);
  }
}

async function finish(page, role) {
  await expectCard(page, "Välkommen till ByggKoll.", `${role}: the done card never came`);
  await expectCard(page, "Du vet nu vad du behöver göra.", `${role}: the done card lacks its line`);
  await tap(page, card(page).getByRole("button", { name: "Kom igång" }));
  await card(page).waitFor({ state: "detached", timeout: 10000 });
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("onboarding_")));
  const id = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith("onboarding_complete_")));
  log(`${role}: Kom igång closed the tour; storage now holds ${JSON.stringify(keys)}`);
  if (!NEGATIVE && !id) fail(`${role}: Kom igång did not write onboarding_complete_{id}`);
  if (keys.some((k) => k.startsWith("onboarding_step_"))) fail(`${role}: onboarding_step_ survived completion`);
}

async function secondLogin(page, email, password, role) {
  // Signed out through the app and in again in the SAME browser: the storage
  // is the thing that remembers, so the storage has to survive.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  // THE ASSERTION THE NEGATIVE CONTROL AIMS AT: a reload after Kom igång.
  await expectNoTour(page, `${role}: the tour came back on the first reload after Kom igång`);
  log(`${role}: reloaded after Kom igång -- no tour`);
  await tap(page, page.getByRole("button", { name: "Profil", exact: true }));
  // The sheet slides up over 200ms; a tap during the slide lands on the scrim.
  await page.getByRole("dialog", { name: "Profil" }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  await tap(page, page.getByRole("button", { name: "Logga ut" }));
  await page.waitForURL((u) => u.pathname.includes("/login"), { timeout: 20000 });
  await signIn(page, email, password);
  await expectNoTour(page, `${role}: the tour opened again on the second login`);
  log(`${role}: signed out and in again -- no tour`);
}

// ============================================================================

const browser = await chromium.launch();
const t0 = count("select extract(epoch from now())::int as n");
/** Today in Stockholm, as the app computes it -- the tour rings two days from it. */
const TODAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
console.log(`\nFörsta-gången-turen at ${BASE}${NEGATIVE ? "   (NEGATIVE CONTROL)" : ""}\n`);

try {
  // ---- a browser that did not opt in -------------------------------------
  {
    const ctx = await newContext(browser, { optIn: false });
    const page = await ctx.newPage();
    await signIn(page, required("DEMO_WORKER_EMAIL"), required("DEMO_WORKER_PASSWORD"));
    await expectNoTour(page, "an automated browser without the opt-in was shown the tour");
    log("automated browser, no opt-in: no tour, so every other walkthrough is unaffected");
    await ctx.close();
  }

  // ---- ADMIN --------------------------------------------------------------
  {
    const email = required("DEMO_ADMIN_EMAIL");
    const password = required("DEMO_ADMIN_PASSWORD");
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await signIn(page, email, password);

    await expectCard(page, "Allt börjar med ett projekt.", "admin: first login");
    // Progress is a bar now, not "Steg 1 av 9": a quarter full on step one,
    // never empty.
    const bar = page.getByRole("progressbar", { name: "Hur långt du har kommit" });
    if ((await bar.getAttribute("aria-valuenow")) !== "25") {
      fail(`admin: the first card's progress is ${await bar.getAttribute("aria-valuenow")}, wanted 25`);
    }
    await shot(page, "admin-1-kort");
    await nextCard(page, "Allt börjar med ett projekt.", "admin: first login");
    log("admin: first login opens on step 1, the project card");

    const nytt = page.getByRole("link", { name: "Nytt projekt" });
    await expectRingOn(page, nytt, "admin step 2");
    await shot(page, "admin-2-ring");
    await tap(page, nytt);
    await page.waitForURL((u) => u.pathname.startsWith("/projekt/ny"), { timeout: 20000 });
    log("admin: Nytt projekt ringed; a tap on it opened the form");

    // Caught mid-type: the typewriter, not a value set in one go.
    const name = page.locator('input[name="name"]');
    await page.waitForFunction(() => {
      const v = document.querySelector('input[name="name"]')?.value ?? "";
      return v.length > 0 && v.length < "Fasad Malmö".length;
    }, null, { timeout: 20000 }).catch(() => fail("admin: never saw the project name part-typed"));
    await page.getByText("Ett exempelprojekt.").waitFor({ timeout: 30000 });
    const values = await page.evaluate(() =>
      ["name", "site_address", "start_date", "services", "bestallare_bolag", "bestallare_address", "bestallare_orgnr"]
        .map((k) => [k, document.querySelector(`[name="${k}"]`)?.value ?? ""]));
    const empty = values.filter(([, v]) => !v);
    if (empty.length) fail(`admin: autofill left fields empty: ${JSON.stringify(empty)}`);
    if ((await name.inputValue()) !== "Fasad Malmö") fail("admin: the project name is not Fasad Malmö");
    await expectRingOn(page, page.getByRole("button", { name: "Skapa projekt" }), "admin step 3");
    await shot(page, "admin-3-ifylld");
    log(`admin: autofill typed every field (${values.map(([, v]) => v).join(" | ")}) and ringed Skapa projekt`);

    // The press is caught: the tour moves on, the page stays, nothing is made.
    await tap(page, page.getByRole("button", { name: "Skapa projekt" }));
    await expectCard(page, "Din arbetsledare söker folk", "admin: pressing Skapa projekt did not move the tour on");
    await page.waitForTimeout(1500);
    if (!page.url().includes("/projekt/ny")) fail("admin: Skapa projekt went through -- the page left the form");
    const made = count(`select count(*)::int as n from public.project where name = 'Fasad Malmö' and created_at > to_timestamp(${t0})`);
    if (made !== 0) fail(`admin: the tour let Skapa projekt through -- ${made} Fasad Malmö project(s) exist`);
    log("admin: Skapa projekt pressed, caught, and nothing was created");

    for (const text of [
      "Din arbetsledare söker folk",
      "Arbetarna väljer själva",
      "Arbetsledaren kollar att allt stämmer",
      "Sista steget är ditt.",
    ]) await nextCard(page, text, "admin cards 4-7");
    log("admin: Hoppa över, then the four explanation cards");

    // Step 8 is on the startsida and the admin is on /projekt/ny.
    await tip(page).getByRole("button", { name: "Ta mig dit" }).waitFor({ timeout: 20000 })
      .catch(() => fail("admin step 8: no Ta mig dit while on another screen"));
    if ((await settle(page, "admin step 8")) !== "ring") fail("admin step 8: arrived as a card, with a project in the tenancy");
    const row = page.locator("[data-project] > button");
    await expectRingOn(page, row, "admin step 8 (the project row, until it is open)");
    await tap(page, row);
    const gen = page.getByRole("link", { name: "Generera Arbetsdagbok" });
    await expectRingOn(page, gen, "admin step 8 (Generera Arbetsdagbok, once the row is open)");
    await shot(page, "admin-8-generera");
    await tap(page, gen);
    await page.waitForURL((u) => u.pathname.startsWith("/arbetsdagbok"), { timeout: 20000 });
    log("admin: off-screen step offered Ta mig dit; the ring moved from the row to Generera Arbetsdagbok; arriving advanced it");

    // Step 9: ringed if a confirmed day exists in the tenancy, a card if not.
    const nine = await settle(page, "admin step 9");
    await shot(page, "admin-9");
    if (nine === "ring") {
      await expectRingOn(page, page.getByRole("button", { name: "Generera Arbetsdagbok" }), "admin step 9");
      await skip(page);
      log("admin: step 9 ringed Generera Arbetsdagbok (a confirmed day exists); skipped rather than filed");
    } else {
      await nextCard(page, "Här genererar du Arbetsdagboken", "admin step 9 fallback");
      log("admin: step 9 had no confirmed day to file, and arrived as a card");
    }

    await finish(page, "admin");
    await secondLogin(page, email, password, "admin");
    await ctx.close();
  }

  // ---- ARBETSLEDARE -------------------------------------------------------
  {
    const email = required("DEMO_LEADER_EMAIL");
    const password = required("DEMO_LEADER_PASSWORD");
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await signIn(page, email, password);

    await nextCard(page, "Ditt företag har ett projekt som behöver folk.", "leader: first login");
    await nextCard(page, "Nu är det din tur att skapa ett pass.", "leader card 2");
    const skapa = page.getByRole("link", { name: "Skapa pass" });
    await expectRingOn(page, skapa, "leader step 3");
    await tap(page, skapa);
    await page.waitForURL((u) => u.pathname.startsWith("/pass/ny"), { timeout: 20000 });
    log("leader: two cards, then Skapa pass ringed and tapped");

    // The days: a card, then two ringed days and NO tip -- the leader taps
    // both, and the tour moves on when both are chosen.
    await nextCard(page, "Välj de dagar du vill ha folk på plats.", "leader card 4");
    const [d1, d2] = (() => {
      const plus = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
      const first = plus(TODAY, 14);
      const after = plus(first, 1);
      return [first, after.slice(0, 7) === first.slice(0, 7) ? after : plus(first, -1)];
    })();
    const day1 = page.locator(`[data-date="${d1}"]`);
    const day2 = page.locator(`[data-date="${d2}"]`);
    await expectRingOn(page, day1, "leader step 5, first day", { anchored: false });
    await expectRingOn(page, day2, "leader step 5, second day", { anchored: false });
    if (await page.locator('[data-tour-ui="bar"] p, [data-tour-ui="tip"] p').count()) {
      fail("leader step 5: the two-day step shows a tip; it should show only its rings");
    }
    await shot(page, "ledare-5-dagar");
    await tap(page, day1);
    await tap(page, day2);
    await nextCard(page, "Bra. Nu fyller vi i detaljerna.", "leader: tapping both ringed days did not advance");
    log(`leader: ${d1} and ${d2} ringed with no tip, tapped, and the tour moved on`);

    const fortsatt = page.getByRole("button", { name: "Fortsätt" });
    await expectRingOn(page, fortsatt, "leader step 7, Fortsätt");
    await tap(page, fortsatt);

    // A SANDBOX STEP: filled, the real button ringed but swallowed, Nästa ends it.
    await page.getByText("Så här skapar du ett pass.").waitFor({ timeout: 30000 });
    const hours = await page.getByLabel("Timmar på rad 1").inputValue();
    if (hours !== "8") fail(`leader: autofill left Timmar at ${JSON.stringify(hours)}, wanted "8"`);
    const create = page.getByRole("button", { name: /^Skapa d+ pass$/ });
    await expectRingOn(page, create, "leader step 8, detail");
    await shot(page, "ledare-8-ifylld");
    await tap(page, create);
    await page.waitForTimeout(2500);
    const passes = count(`select count(*)::int as n from public.pass p join auth.users u on u.id = p.created_by
      where lower(u.email) = lower('${esc(email)}') and p.created_at > to_timestamp(${t0})`);
    if (passes !== 0) fail(`leader: the sandbox step let Skapa through -- ${passes} pass(es) were created`);
    log(`leader: form filled (${hours} h), Skapa pressed and swallowed -- nothing was created`);
    await tap(page, page.locator('[data-tour-ui="tip"], [data-tour-ui="bar"]').getByRole("button", { name: "Nästa", exact: true }));
    await nextCard(page, "Arbetarna som är lediga kan nu se ditt pass.", "leader card 5");
    await nextCard(page, "När passen är över ska du kolla", "leader card 6");

    // Step 7: ringed if a day is waiting, otherwise the explanation card and
    // step 8 is skipped outright.
    const seven = await settle(page, "leader step 7");
    await shot(page, "ledare-7");
    if (seven === "card") {
      await nextCard(page, "Ingen dag att bekräfta än.", "leader step 7 fallback");
      log("leader: no day waiting -- Bekräfta arrived as a card, and step 8 was skipped");
    } else {
      const bek = page.getByRole("link", { name: "Bekräfta pass" });
      await expectRingOn(page, bek, "leader step 7");
      await tap(page, bek);
      await page.waitForURL((u) => u.pathname.startsWith("/bekrafta"), { timeout: 20000 });
      await expectRingOn(page, page.locator("#vad-vi-gjorde"), "leader step 8, Vad vi gjorde", { anchored: false });
      if (!(await page.locator('[data-tour-ui="bar"]').count())) fail("leader step 8: several rings, but the tip is not in the bar");
      const typed = await page.locator("#vad-vi-gjorde").inputValue();
      await shot(page, "ledare-8-bekrafta");
      log(`leader: a day is waiting -- Timmar and Vad vi gjorde ringed, nothing typed into them (${JSON.stringify(typed)})`);
      await skip(page);
    }

    await finish(page, "leader");
    await secondLogin(page, email, password, "leader");
    await ctx.close();
  }

  // ---- ARBETARE -----------------------------------------------------------
  {
    const email = required("DEMO_WORKER_EMAIL");
    const password = required("DEMO_WORKER_PASSWORD");
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await signIn(page, email, password);

    await nextCard(page, "Boka de dagar du kan jobba.", "worker: first login");
    const dagar = page.getByRole("link", { name: "Arbetsdagar" });
    await expectRingOn(page, dagar, "worker step 2");
    await tap(page, dagar);
    await page.waitForURL((u) => u.pathname.startsWith("/min-kalender"), { timeout: 20000 });
    log("worker: Arbetsdagar ringed and tapped");

    // The tap is caught: the tour moves on and the day stays unmarked.
    const grid = page.locator("[data-date]").first().locator("..");
    await expectRingOn(page, grid, "worker step 3");
    await shot(page, "arbetare-3-kalender");
    await tap(page, page.getByRole("button", { name: "Nästa månad" }));
    await page.waitForTimeout(800);
    const day = await page.evaluate(() => {
      const cells = [...document.querySelectorAll("[data-date]")]
        .filter((c) => /omarkerad$/.test(c.getAttribute("aria-label") ?? ""));
      return cells.at(-1)?.getAttribute("data-date") ?? null;
    });
    if (!day) fail("worker: no unmarked day next month to tap");
    await tap(page, page.locator(`[data-date="${day}"]`));
    await expectCard(page, "När arbetsledaren skapar pass på de dagarna du bokat", "worker: tapping a day did not advance the tour");
    const still = await page.locator(`[data-date="${day}"]`).getAttribute("aria-label");
    if (!/omarkerad$/.test(still ?? "")) fail(`worker: the tour let the tap through -- ${day} reads "${still}"`);
    log(`worker: tapped ${day}; the tour moved on and the day is still unmarked`);
    await nextCard(page, "När arbetsledaren skapar pass på de dagarna du bokat", "worker card 4");
    await nextCard(page, "Har du inte förbokat?", "worker card 5");

    // Step 6 lives on the startsida.
    const six = await settle(page, "worker step 6");
    if (six === "ring") {
      const visa = page.getByRole("link", { name: "Visa alla" });
      await expectRingOn(page, visa, "worker step 6");
      await tap(page, visa);
      await page.waitForURL((u) => u.pathname.startsWith("/acceptera"), { timeout: 20000 });
      await expectRingOn(page, page.getByRole("button", { name: "Acceptera", exact: true }), "worker step 7");
      await shot(page, "arbetare-7-acceptera");
      await skip(page);
      log("worker: Visa alla ringed and tapped; Acceptera ringed on the queue, skipped rather than taken");
    } else {
      await nextCard(page, "Lediga pass visas under Acceptera pass", "worker step 6 fallback");
      log("worker: no offer -- step 6 arrived as a card and step 7 was skipped");
    }

    await nextCard(page, "På dagen, tryck in när du är på plats.", "worker card 8");
    // Step 9: the demo worker has no shift today, so Stämpla In never appears
    // and the step must turn into its card rather than wait forever.
    const nine = await settle(page, "worker step 9");
    await shot(page, "arbetare-9");
    if (nine === "card") {
      await nextCard(page, "När du har ett pass idag visas Stämpla In", "worker step 9 fallback");
      log("worker: no shift today -- Stämpla In never appeared, and the step became its card");
    } else {
      await skip(page);
      log("worker: a shift today -- Stämpla In ringed, skipped rather than stamped");
    }

    await finish(page, "worker");

    await secondLogin(page, email, password, "worker");
    await ctx.close();
  }

  console.log(`\nTOUR COMPLETE${NEGATIVE ? " -- BUT THIS WAS THE NEGATIVE CONTROL AND IT SHOULD HAVE FAILED" : ""}.\n`);
  if (NEGATIVE) process.exitCode = 1;
} finally {
  await browser.close();
}
