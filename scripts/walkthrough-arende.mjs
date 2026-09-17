#!/usr/bin/env node
/**
 * Öppna dag's three actions, and Tilldela Ärende, in a browser.
 *
 * What it proves:
 *   - NO DATE OR TIME INPUT ESCAPES ITS CARD. Measured, not eyeballed: the
 *     Datum field on the day page and the Starttid/Sluttid pair inside the
 *     ärende form -- the flex row being the case that actually broke -- are
 *     each checked against the box that is supposed to contain them.
 *   - the admin's day page reads heading, then the three actions, then the
 *     shifts, in that order down the page
 *   - Snabb Pass and Skapa Pass carry the tapped date with them
 *   - Hela dagen starts ON, and turning it off reveals Starttid and Sluttid
 *   - the colour picker offers the eight the check constraint permits, and
 *     nothing to type into
 *   - the viewer picker sorts arbetsledare to the top and names everyone's role
 *   - saving writes the ärende, closes the form and says so
 *   - the ärende shows on the day page and as a DOT on the calendar -- a dot,
 *     not a stripe, because it is not a site working
 *   - AND ONLY FOR THE OWNER AND THE PEOPLE NAMED. The leader who was named
 *     sees it; the leader who was not sees neither the card nor the dot. That
 *     is RLS, and this is the browser agreeing with the suite about it.
 *   - an arbetsledare gets no Tilldela Ärende button: the three actions are
 *     the admin's
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ART = "artifacts";
const RUN = Date.now().toString().slice(-6);
mkdirSync(ART, { recursive: true });

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };

const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();
const shot = (page, name) => page.screenshot({ path: path.join(ART, `${name}.png`), fullPage: true });

async function mustSee(page, text, why) {
  try { await page.getByText(text, { exact: false }).first().waitFor({ timeout: 25000 }); }
  catch {
    await shot(page, "FAILED-arende");
    const seen = await page.locator("main, body").first().innerText().catch(() => "(nothing)");
    fail(`${why} (never saw "${text}")\n--- screen ---\n${seen.slice(0, 700)}`);
  }
}
async function mustNotSee(page, text, why) {
  await page.waitForTimeout(1000);
  if (await page.getByText(text, { exact: false }).count()) {
    await shot(page, "FAILED-arende"); fail(`${why} (saw "${text}")`);
  }
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await page.locator("form").waitFor({ timeout: 20000 });
  await field(page, "E-post").fill(email);
  await field(page, "Lösenord").fill(password);
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.waitForLoadState("networkidle");
}
async function signOut(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  if (!(await page.getByRole("button", { name: "Logga ut" }).count())) {
    await page.getByRole("button", { name: "Profil", exact: true }).click();
  }
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
  await page.getByRole("button", { name: "Tillverka arbetare" }).click();
  await page.getByText("Klar", { exact: false }).first().waitFor({ timeout: 20000 });
  return { email, password, name };
}

async function createProject(page, name, leaderLabel, today) {
  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  await field(page, "Projektnamn").fill(name);
  await field(page, "Projektets adress").fill("Bruksgatan 8, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Bygg");
  await field(page, "Startdatum").fill(today);
  await field(page, "Arbetsledare").selectOption({ label: leaderLabel });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
}

/** Tap a calendar cell the way a thumb does -- touch, not mouse (CLAUDE.md). */
async function tapDay(page, date) {
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.waitFor({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(500);
}

/**
 * One pass on the day, so the calendar cell carries a STRIPE as well as a dot.
 *
 * Without it the dot has nothing to be different from, and the assertion that
 * the two read as different objects quietly skips -- which is how a check that
 * proves nothing survives review.
 */
async function makeBatch(page, project, dates, hours) {
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  for (const d of dates) await tapDay(page, d);
  await page.getByRole("button", { name: "Fortsätt", exact: true }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: project });
  await page.getByLabel("Timmar på rad 1").fill(hours);
  await page.getByRole("button", { name: /Skapa \d+ pass/ }).click();
  await mustSee(page, "Passen är skapade", `the batch for ${project} did not generate`);
}

async function openDay(page, date) {
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
  await tapDay(page, date);
  await page.waitForURL((u) => u.pathname.includes("/dag") && u.search.includes(date), {
    timeout: 20000,
  });
  await page.waitForLoadState("networkidle");
  await page.locator(`[data-day-panel="${date}"]`).waitFor({ timeout: 20000 });
}

/**
 * Does a control stay inside the box that is supposed to contain it?
 *
 * The failure this exists for is specific: a native date or time input sizes
 * itself to its own value and paints straight out through a narrower parent.
 * A screenshot shows it; a class name does not, so this measures.
 *
 * The container is found by walking UP from the input rather than by a
 * selector of its own -- `hops` divs, since every element between an input and
 * its card is a label or a span. A selector would be a second description of
 * the markup, and the one that goes stale without failing.
 */
async function mustFitInside(page, innerSel, hops, what) {
  const box = await page.evaluate(([sel, up]) => {
    const a = document.querySelector(sel);
    if (!a) return null;
    let b = a;
    for (let i = 0; i < up; i++) {
      b = b.closest("div");
      if (!b) return null;
      if (i < up - 1) b = b.parentElement;
    }
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return {
      left: ra.left - rb.left,
      right: rb.right - ra.right,
      width: Math.round(ra.width),
      outer: Math.round(rb.width),
    };
  }, [innerSel, hops]);

  if (!box) fail(`${what}: could not find ${innerSel}, or the box ${hops} level(s) above it`);
  // A whole pixel of slack, for sub-pixel layout. Anything more negative is
  // the control painting outside the thing that owns its width.
  if (box.left < -1 || box.right < -1) {
    await shot(page, "FAILED-arende");
    fail(
      `${what} escapes its container: ${box.left.toFixed(1)}px past the left edge, `
      + `${box.right.toFixed(1)}px past the right (field ${box.width}px, container ${box.outer}px)`,
    );
  }
  return box;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
const ymd = (n) => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};

/**
 * The day everything happens on: soon, and in THIS month.
 *
 * In this month because the calendar would otherwise need paging before the
 * cell exists; not in the past because Skapa Pass refuses to preselect a day
 * that has already happened, and that is one of the things being checked.
 */
const DAY = (() => {
  for (let n = 1; n <= 5; n++) if (ymd(n).slice(0, 7) === today.slice(0, 7)) return ymd(n);
  return today;   // the last days of a month: today is always in today's month
})();

const TITLE = `Platsbesök ${RUN}`;
const COLOUR = "#6c3fc5";          // violet, the third of the eight
const PALETTE = ["#1b2cc1", "#0f6f7a", "#6c3fc5", "#1f7a3d",
                 "#8a5300", "#8e1d15", "#0a5ea8", "#7a3f8f"];

console.log(`\nÄrende: "${TITLE}" on ${DAY}\n`);

try {
  // ---- setup ---------------------------------------------------------------
  await signIn(page, required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));
  const NAMED = await createPerson(page, `Nina Namngiven ${RUN}`, `nn.${RUN}@bella.test`, "arbetsledare");
  const UNNAMED = await createPerson(page, `Ulf Utanför ${RUN}`, `uu.${RUN}@bella.test`, "arbetsledare");
  const PROJECT = `Ärendeplatsen ${RUN}`;
  await createProject(page, PROJECT, NAMED.name, today);
  await makeBatch(page, PROJECT, [DAY], "8");
  log(`created two arbetsledare, a project, and one pass on ${DAY} for the dot to be told apart from`);

  // ---- 1. the day page, and the field that used to escape it ---------------
  await openDay(page, DAY);

  // One hop: input -> span -> span -> label -> the Card's div.
  const datum = await mustFitInside(
    page, 'input[type="date"]', 1, "the Datum field on Öppna dag",
  );
  log(`the Datum field fits its card (${datum.width}px wide, ${datum.left.toFixed(0)}px / ${datum.right.toFixed(0)}px clear)`);

  /**
   * AND THE MECHANISM, not only the outcome.
   *
   * Measuring the box is a floor, and on its own it is close to vacuous: the
   * overflow this fixes is iOS Safari sizing a date control to its own value,
   * and headless Chromium does not reproduce it -- stripping the wrapper and
   * the shadow-part CSS leaves the measurement above still passing. Verified
   * by doing exactly that, which is the only way to find out.
   *
   * So the guarantee is asserted directly: the wrapper may shrink below the
   * control's intrinsic width (min-width: 0) and clips whatever it still
   * draws (overflow: hidden), and the input may shrink inside it. Those three
   * are what make the box no longer the input's to decide, and removing any of
   * them fails here even on a browser that would not show the symptom.
   */
  const clip = await page.evaluate(() => {
    const i = document.querySelector('input[type="date"]');
    const w = i.parentElement;
    const cs = getComputedStyle(w), ci = getComputedStyle(i);
    return {
      wrapperOverflow: cs.overflowX, wrapperMin: cs.minWidth, inputMin: ci.minWidth,
    };
  });
  if (clip.wrapperOverflow !== "hidden") {
    fail(`the date field's wrapper does not clip (overflow-x: ${clip.wrapperOverflow}), so a control that ignores its width can paint outside the card`);
  }
  if (clip.wrapperMin !== "0px" || clip.inputMin !== "0px") {
    fail(`the date field cannot shrink to its box (wrapper min-width ${clip.wrapperMin}, input min-width ${clip.inputMin}) -- a flex child defaults to min-content and pushes its row wider`);
  }
  log("its wrapper clips, and both it and the input may shrink below the control's own idea of its width");

  // ---- 2. heading, then the three actions, then the shifts -----------------
  for (const label of ["Tilldela Ärende", "Snabb Pass", "Skapa Pass"]) {
    if (!(await page.getByText(label, { exact: true }).count())) {
      await shot(page, "FAILED-arende");
      fail(`the admin's day page does not offer "${label}"`);
    }
  }

  const order = await page.evaluate((date) => {
    const y = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect().top : null;
    };
    const heading = [...document.querySelectorAll("p")]
      .find((p) => /^[A-ZÅÄÖ]+DAG /.test(p.innerText.trim()));
    return {
      heading: heading ? heading.getBoundingClientRect().top : null,
      // href, not text: trailingSlash rewrites the query onto "/snabb/?datum=",
      // so the link is matched on the route rather than on an exact string.
      actions: y('a[href*="/snabb"]'),
      shifts: y(`[data-day-panel="${date}"]`),
    };
  }, DAY);

  if (order.heading === null) fail("the day page draws no date heading");
  if (order.actions === null) fail("the day page draws no action buttons");
  if (!(order.heading < order.actions && order.actions < order.shifts)) {
    await shot(page, "FAILED-arende");
    fail(
      `the day page is out of order: heading ${order.heading}px, actions ${order.actions}px, `
      + `shifts ${order.shifts}px -- expected heading, then actions, then shifts`,
    );
  }
  await shot(page, "arende-dag");
  log("the day reads heading, then the three actions, then the shifts");

  // ---- 3. the two doors carry the date -------------------------------------
  await page.getByRole("link", { name: "Snabb Pass", exact: true }).click();
  await page.waitForURL((u) => u.pathname.includes("/snabb"), { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  const snabbDate = await field(page, "Datum").inputValue();
  if (snabbDate !== DAY) fail(`Snabb Pass opened on ${snabbDate}, not the day that was tapped (${DAY})`);
  log(`Snabb Pass opens on ${DAY} rather than on today`);

  await openDay(page, DAY);
  await page.getByRole("link", { name: "Skapa Pass", exact: true }).click();
  await page.waitForURL((u) => u.pathname.includes("/pass/ny"), { timeout: 20000 });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  const picked = await page.locator("[data-picked-count]").first().getAttribute("data-picked-count");
  if (picked !== "1") fail(`Skapa Pass preselected ${picked} days, expected exactly the one tapped`);
  if (!(await page.locator(`[data-date="${DAY}"]`).count())) {
    fail(`Skapa Pass did not open on the month holding ${DAY}`);
  }
  log(`Skapa Pass opens on ${DAY}'s month with that one day already picked`);

  // ---- 4. the form ---------------------------------------------------------
  await openDay(page, DAY);
  await page.getByRole("button", { name: "Tilldela Ärende" }).click();
  await mustSee(page, "Tilldela ärende", "the ärende form did not open");

  const helaDagen = page.getByRole("checkbox", { name: "Hela dagen" });
  if ((await helaDagen.getAttribute("aria-checked")) !== "true") {
    fail("Hela dagen does not start on");
  }
  await mustNotSee(page, "Starttid", "the time fields are drawn while Hela dagen is on");
  log("Hela dagen starts on, and the time fields are not drawn behind it");

  // Turning it off is the FLEX ROW case -- two native time controls sharing a
  // row, which is exactly where the old overflow was worst.
  await helaDagen.click();
  await page.locator('input[type="time"]').first().waitFor({ timeout: 10000 });
  const row = await page.evaluate(() => {
    const ins = [...document.querySelectorAll('input[type="time"]')];
    if (ins.length < 2) return null;
    // input -> span -> span -> label -> the flex-1 column -> the flex row.
    const parent = ins[0].closest("div").parentElement;
    const rp = parent.getBoundingClientRect();
    return ins.map((i) => {
      const r = i.getBoundingClientRect();
      return { left: r.left - rp.left, right: rp.right - r.right, width: Math.round(r.width) };
    });
  });
  if (!row) fail("Hela dagen off did not reveal two time fields");
  for (const [i, r] of row.entries()) {
    if (r.left < -1 || r.right < -1) {
      await shot(page, "FAILED-arende");
      fail(`time field ${i + 1} escapes its flex row by ${Math.min(r.left, r.right).toFixed(1)}px`);
    }
  }
  log(`Starttid and Sluttid share a row and stay inside it (${row.map((r) => `${r.width}px`).join(" + ")})`);

  // Back to all-day: that is what this ärende is.
  await helaDagen.click();

  // The palette, and nothing to type into.
  const swatches = await page.locator("[data-colour]").evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-colour")));
  if (JSON.stringify(swatches) !== JSON.stringify(PALETTE)) {
    fail(`the colour picker offers ${JSON.stringify(swatches)}, not the eight the constraint permits`);
  }
  if (await page.locator('input[name*="colour" i], input[type="color"]').count()) {
    fail("the colour can be typed in, so a value the database refuses is reachable");
  }
  log("eight swatches, and no field to type a ninth colour into");

  // The viewer picker: arbetsledare first, everybody labelled with their role.
  const rows = await page.locator('[data-viewer-picker] [role="checkbox"]').evaluateAll((els) =>
    els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  if (rows.length < 2) fail(`the viewer picker listed ${rows.length} accounts, expected the company`);
  const ranks = rows.map((t) => (/Arbetsledare/.test(t) ? 0 : 1));
  if (ranks.some((r, i) => i > 0 && r < ranks[i - 1])) {
    fail(`arbetsledare are not sorted to the top:\n    ${rows.join("\n    ")}`);
  }
  const unlabelled = rows.filter((t) => !/(Arbetsledare|Admin|Arbetare)$/.test(t));
  if (unlabelled.length) fail(`accounts listed without a role: ${unlabelled.join(", ")}`);
  log(`the picker lists ${rows.length} accounts, arbetsledare first, each with its role`);

  // ---- 5. save it ----------------------------------------------------------
  await field(page, "Titel").fill(TITLE);
  await field(page, "Beskrivning").fill("Genomgång med beställaren.");
  await page.locator(`[data-colour="${COLOUR}"]`).click();
  await page.getByRole("checkbox", { name: new RegExp(NAMED.name) }).click();
  await shot(page, "arende-form");
  await page.getByRole("button", { name: /Spara ärende/ }).click();

  await mustSee(page, "Ärendet är sparat", "saving the ärende said nothing");
  await mustNotSee(page, "Spara ärende", "the form stayed open after saving");
  await mustSee(page, TITLE, "the saved ärende is not on the day it was written for");
  if (!(await page.locator(`[data-day-arenden="${DAY}"] [data-handelse]`).count())) {
    fail("the ärende is on the page but not in the day's Ärenden section");
  }
  await mustSee(page, `Delad med ${NAMED.name}`, "the day does not say who the ärende was shared with");
  log(`"${TITLE}" is saved, the form is closed, and the day names who can see it`);

  // ---- 6. the dot on the calendar -----------------------------------------
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
  const cell = page.locator(`[data-date="${DAY}"]`);
  await cell.waitFor({ timeout: 20000 });
  await page.locator(`[data-date="${DAY}"] [data-arende-dot]`).first().waitFor({ timeout: 20000 });

  /**
   * Read against the cell's OWN declared count, not against 1.
   *
   * This database is the one every walkthrough has ever written to, and a
   * previous run of this script may well have left an ärende on the same day.
   * Asserting "exactly one" would make the script pass or fail by how recently
   * somebody ran it, which is worse than not checking. So: the day declares a
   * number, the dots are checked against THAT, and this run's own ärende is
   * found by the colour it chose.
   */
  const dot = await page.evaluate((date) => {
    const cell = document.querySelector(`[data-date="${date}"]`);
    const ds = [...cell.querySelectorAll("[data-arende-dot]")];
    const s = cell.querySelector("[data-stripe]");
    const r = ds[0].getBoundingClientRect();
    return {
      colours: ds.map((d) => getComputedStyle(d).backgroundColor),
      // In px, as the browser resolves it -- `rounded-full` computes to a huge
      // value the engine prints in scientific notation, so this is compared as
      // a number against half the box rather than matched as a string.
      radius: parseFloat(getComputedStyle(ds[0]).borderRadius),
      width: Math.round(r.width), height: Math.round(r.height),
      stripeWidth: s ? Math.round(s.getBoundingClientRect().width) : null,
      declared: Number(cell.getAttribute("data-arenden")),
      label: cell.getAttribute("aria-label"),
    };
  }, DAY);

  // 108, 63, 197 is #6c3fc5. The dot wears the colour that was chosen, which
  // is the only thing on the grid that says which ärende it is.
  if (!dot.colours.includes("rgb(108, 63, 197)")) {
    fail(`no dot on ${DAY} wears the violet that was picked (${COLOUR}); the day draws ${dot.colours.join(", ")}`);
  }
  // A DOT, NOT A STRIPE. Round and small is the difference a glance reads; a
  // same-coloured bar would say a ninth site is working that day.
  if (dot.width !== dot.height) fail(`the ärende mark is ${dot.width}x${dot.height}px -- that is a bar, not a dot`);
  if (!(dot.radius >= dot.width / 2)) {
    fail(`the ärende mark is not round: ${dot.radius}px radius on a ${dot.width}px box`);
  }
  // A stripe was put on this day precisely so there is one to compare against.
  // Skipping the comparison for want of a stripe would be the check passing
  // because it never ran.
  if (dot.stripeWidth === null) fail(`${DAY} draws no project stripe, so the dot has nothing to be distinct from`);
  if (dot.width >= dot.stripeWidth) {
    fail(`the ärende dot is ${dot.width}px wide and a stripe is ${dot.stripeWidth}px -- they read as the same object`);
  }
  // Three dots fit; past that the cell simply stops drawing them, exactly as
  // the stripes cap at four. The arithmetic is checked against what the cell
  // itself says is on the day.
  const MAX_DOTS = 3;
  const expected = Math.min(dot.declared, MAX_DOTS);
  if (dot.declared < 1) fail(`the cell declares ${dot.declared} ärenden after one was saved on it`);
  if (dot.colours.length !== expected) {
    fail(`${DAY} declares ${dot.declared} ärenden and should draw ${expected} dots, drew ${dot.colours.length}`);
  }
  if (!new RegExp(`${dot.declared} ärende`).test(dot.label ?? "")) {
    fail(`the cell's aria-label does not carry the ärende count: "${dot.label}"`);
  }

  // And the cell is still the height every other cell is.
  const heights = await page.locator("[data-date]").evaluateAll((els) =>
    [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().height)))]);
  if (heights.length !== 1) fail(`the ärende changed the grid's geometry: cells are ${heights.join(", ")}px`);
  await shot(page, "arende-kalender");
  log(`the day wears ${dot.colours.length} round ${dot.width}px dot(s), one of them the violet picked, and every cell is still ${heights[0]}px`);

  await signOut(page);

  // ---- 7. who sees it ------------------------------------------------------
  await signIn(page, NAMED.email, NAMED.password);
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
  await page.locator(`[data-date="${DAY}"] [data-arende-dot]`).first().waitFor({ timeout: 20000 });
  await page.goto(`${BASE}/dag/?datum=${DAY}`, { waitUntil: "networkidle" });
  await mustSee(page, TITLE, "the arbetsledare who was named cannot see the ärende");
  await mustSee(page, "Delad med dig", "a named viewer is not told the ärende is somebody else's");
  await mustNotSee(page, "Ta bort", "a named viewer is offered a delete they cannot perform");
  // The three actions are the admin's. A leader reading somebody else's day
  // gets the day, not the controls.
  await mustNotSee(page, "Tilldela Ärende", "an arbetsledare is offered the admin's actions");
  log(`${NAMED.name} was named, and sees the ärende -- read-only, with none of the admin's actions`);
  await signOut(page);

  await signIn(page, UNNAMED.email, UNNAMED.password);
  await page.goto(`${BASE}/dag/?datum=${DAY}`, { waitUntil: "networkidle" });
  await mustNotSee(page, TITLE, "an arbetsledare who was NOT named can read the ärende");
  await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
  await page.locator(`[data-date="${DAY}"]`).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  if (await page.locator(`[data-date="${DAY}"] [data-arende-dot]`).count()) {
    await shot(page, "FAILED-arende");
    fail("an arbetsledare who was not named sees the ärende's dot on the calendar");
  }
  log(`${UNNAMED.name} was not named, and sees neither the card nor the dot`);

  console.log("\n  Ärenden work end to end, and stay inside the list of people who were told.\n");
} finally {
  await browser.close();
}
