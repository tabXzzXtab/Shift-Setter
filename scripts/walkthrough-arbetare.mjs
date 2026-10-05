#!/usr/bin/env node
/**
 * Drive the arbetare's landing page.
 *
 *   the stamp · the notification badge · Mina Pass and Arbetsdagar ·
 *   the Acceptera Pass cards, and what Neka does to one · Öppna Pass.
 *
 * The stamp is checked in both directions and against the DATABASE clock: the
 * assertion is that the time stored is the server's, not the browser's, which
 * is the whole reason clock_in() exists as an RPC.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { connectionString, required } from "./env.mjs";
import { monthLane, reachDate, shiftDays, stockholmToday } from "./wt-dates.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });

const ADMIN = {
  email: required("WALKTHROUGH_ADMIN_EMAIL"),
  password: required("WALKTHROUGH_ADMIN_PASSWORD"),
};
const RUN = Date.now().toString().slice(-6);

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

const landed = (page) =>
  page.getByRole("button", { name: "Meny", exact: true }).waitFor({ timeout: 30000 });

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

/** Read before tapping: the calendar gesture is a toggle. */
async function markDay(page, date) {
  const marked = () => page.locator(`[data-date="${date}"][aria-label*="kan jobba"]`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
    await reachDate(page, date, fail);
    await page.waitForTimeout(800);
    if (await marked().count()) return;
    await page.getByRole("button", { name: "Kan jobba", exact: true }).click();
    const cell = page.locator(`[data-date="${date}"]`);
    await cell.scrollIntoViewIfNeeded();
    const b = await cell.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(2000);
  }
  await shot(page, "FAILED");
  fail(`could not mark ${date} as a day they can work`);
}

async function makePass(page, project, date, hours, pick) {
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Välj dagar" }).waitFor({ timeout: 20000 });
  // The lane can put the block in the next month; page to it rather than
  // waiting out twenty seconds on a cell this month will never draw.
  await reachDate(page, date, fail);
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.waitFor({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.getByRole("button", { name: "Fortsätt", exact: true }).click();
  await page.getByRole("heading", { name: "Beskriv passen" }).waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: project });
  await page.getByLabel("Timmar på rad 1").fill(hours);
  if (pick) await page.getByRole("button", { name: pick, exact: true }).click();
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "Passen är skapade", `the pass on ${date} was not created`);
}

const db = new pg.Client({
  connectionString: connectionString(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
await db.connect();

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  // On Stortorget in Malmö, the ADDRESS this run's project is created at. The
  // stamp is geofenced to 4 km, and a browser that will not say where it is
  // gets refused before clock_in() is ever called.
  permissions: ["clipboard-read", "clipboard-write", "geolocation"],
  geolocation: { latitude: 55.60662, longitude: 12.99968 },
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

const today = stockholmToday();
// An IN-MONTH lane across the whole block, so repeated sweeps do not stack
// five open days on the same five dates. 8 is the furthest day needed, so the
// lane is the slack the month has left after it; when there is none the lane
// is 0 and the block crosses into next month, where reachDate pages to it.
const LANE = monthLane(RUN, 8, today);
// Five open days, so the stack has more behind it than it is allowed to show
// and the cap is something the test can actually see.
const OPEN = [4, 5, 6, 7, 8].map((n) => shiftDays(today, n + LANE));

/**
 * A second held shift, two days out, and it is not decoration.
 *
 * Nästa Pass drops a shift the moment its end_time passes rather than at
 * midnight. Today's shift here runs 07:00-16:00, so from 16:00 onwards it is
 * correctly gone -- and with nothing behind it the card reads "Inga kommande
 * pass" and the assertion below fails for a reason that is the fix working.
 * A run must not depend on the hour it is started at.
 */
// Laned with the rest, so the second held shift travels with the block it
// belongs to rather than being left behind on today+2 every run.
const SOON = shiftDays(today, 2 + LANE);
const soon = OPEN[0];
const ADDRESS = "Stortorget 1, 211 22 Malmö";

console.log(`\nArbetare landing page at ${BASE}\n`);

try {
  // ---- setup ---------------------------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  const L = await createPerson(page, `Lasse Ledare ${RUN}`, `al.${RUN}@bella.test`, "arbetsledare");
  const W = await createPerson(page, `Wille Arbetare ${RUN}`, `aw.${RUN}@bella.test`, "arbetare");

  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const project = `Torget ${RUN}`;
  await field(page, "Projektnamn").fill(project);
  await field(page, "Projektets adress").fill(ADDRESS);
  await field(page, "Beställarens adress").fill("Fakturagatan 9, 111 22 Stockholm");
  await field(page, "Beställarens bolag").fill("Malmö Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Startdatum").fill(today);
  await field(page, "Arbetsledare").selectOption({ label: L.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  await signOut(page);

  // Today's shift is the one the stamp acts on. The offer is a different day,
  // or the my_offer exclusion filter would hide it.
  await signIn(page, W.email, W.password);
  await markDay(page, today);
  await markDay(page, SOON);
  await signOut(page);

  await signIn(page, L.email, L.password);
  await makePass(page, project, today, "8", W.name);
  await makePass(page, project, SOON, "8", W.name);
  for (const d of OPEN) await makePass(page, project, d, "6", null);  // Tier 3 offers them
  await signOut(page);

  // One shift_deleted, written straight in. The path that CREATES one -- an
  // admin deleting a shift someone holds -- is driven in walkthrough-kalender;
  // what is under test here is that the badge shows up in the right place.
  //
  // It is not the only notice the worker ends up holding: the two hand-picked
  // placements above announce themselves through notify_shift_offered, so the
  // badge step below expects three. Kept as a direct insert anyway, because
  // shift_deleted is the kind this screen was drawn for and no trigger in this
  // setup would produce one.
  await db.query(
    `insert into public.notification (account_id, kind, payload)
     select w.account_id, 'shift_deleted', jsonb_build_object('work_date', $2::text)
     from public.worker w where w.name = $1`, [W.name, soon]);

  log(`a shift today for ${W.name}, ${OPEN.length} open ones, and 3 unread notices ` +
      `(2 placements announced, 1 written here)`);

  // ---- the landing page ----------------------------------------------------
  await signIn(page, W.email, W.password);
  await landed(page);
  await shot(page, "w1-landning");

  for (const label of ["Meny", "Profil"]) {
    if (!(await page.getByRole("button", { name: label, exact: true }).count())) {
      fail(`the top bar has no ${label} button`);
    }
  }
  log("top bar: hamburger left, profile icon right");

  // ---- the handoff's own numbers ------------------------------------------
  //
  // The design is marked HIGH FIDELITY, which is a claim that can be checked
  // rather than admired. These are read back out of the browser as computed
  // values, so a Tailwind arbitrary class that silently failed to compile --
  // the usual way an exact shadow turns into no shadow at all -- fails here
  // instead of shipping.
  const px = (sel, prop) =>
    page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);

  const ground = await px('[data-screen="arbetare"]', "backgroundColor");
  if (ground !== "rgb(247, 246, 243)") {
    fail(`the ground is ${ground}, the Komponentspråk says #f7f6f3`);
  }

  // On the SCREEN, not on body: Inter is loaded as a variable and applied by
  // the one screen that asked for it, so re-fonting the whole app is not a
  // side effect of redesigning this one.
  const font = await px('[data-screen="arbetare"]', "fontFamily");
  if (!/Inter/i.test(font)) {
    fail(`the screen is not set in Inter: ${font}`);
  }

  const primary = page.getByRole("button", { name: /Stämpla/ }).first();
  const [h, radius, bg, shadow] = await Promise.all(
    ["height", "borderRadius", "backgroundColor", "boxShadow"].map((prop) =>
      primary.evaluate((el, p) => getComputedStyle(el)[p], prop)),
  );
  if (h !== "66px") fail(`the primary action is ${h} tall, the handoff says 66`);
  if (radius !== "12px") fail(`the primary action radius is ${radius}, the handoff says 12`);
  // Clocked OUT at this point, so the accent fill, not ink.
  if (bg !== "rgb(232, 122, 70)") {
    fail(`the primary action is ${bg} while clocked out, the brand fill is #e87a46`);
  }
  if (!shadow.includes("rgba(232, 122, 70, 0.28)")) {
    fail(`the primary action has no accent shadow: ${shadow}`);
  }
  log("ground #f7f6f3, Inter, action 66px / radius 12 / #e87a46 with its shadow");


  // ---- the badge sits directly below the stamp -----------------------------
  const stampBtn = () => page.getByRole("button", { name: /Stämpla/ });
  await stampBtn().waitFor({ timeout: 20000 });

  // THREE NOTICES, NOT ONE, and the number is checked rather than tolerated.
  //
  // The fixture writes one shift_deleted by hand. The two hand-picked
  // placements above each fire notify_shift_offered as well -- somebody else
  // putting a worker on a shift tells them, which is the point of it -- so the
  // worker holds 2 x shift_offered + 1 x shift_deleted by the time this runs.
  //
  // It is deterministic. Only three triggers write notifications;
  // notify_day_admin_confirmed and notify_day_rejected need a project_day or a
  // day_review that this setup has not reached, and notify_shift_offered fires
  // on handplockad, forval, manuell and snabb -- so the five OPEN passes, which
  // nobody is picked for, add nothing.
  //
  // This assertion used to expect exactly one and broke on a strict-mode
  // violation when push_dispatch started announcing placements. Asserting the
  // count keeps that from happening silently again: a change in what a
  // placement announces should land here as a failure, not as a different
  // screen nobody looked at.
  const badges = page.getByRole("button", { name: "Okej", exact: true });
  const unread = await badges.count();
  if (unread !== 3) {
    await shot(page, "FAILED");
    fail(`expected 3 unread notices (2 placements announced + 1 written by the ` +
         `fixture), got ${unread}`);
  }
  const [sBox, bBox] = await Promise.all([stampBtn().boundingBox(), badges.first().boundingBox()]);
  if (!(bBox.y > sBox.y + sBox.height)) {
    fail(`the badge is not below the stamp: stamp ends ${sBox.y + sBox.height}, badge at ${bBox.y}`);
  }
  await shot(page, "w1b-notis");
  log(`${unread} notices, and the badge sits directly below the stamp button`);

  // One Okej takes one notice, and none of them comes back. The old check read
  // "zero after a single click", which was only ever true while the fixture
  // produced a single notice -- it would have passed just as happily against a
  // button that cleared the lot.
  for (let left = unread; left > 0; left--) {
    await badges.first().click();
    await page.waitForTimeout(1200);
    const now = await badges.count();
    if (now !== left - 1) {
      await shot(page, "FAILED");
      fail(`dismissing one notice left ${now} on screen, expected ${left - 1}`);
    }
  }
  log("each Okej dismisses exactly one notice, and none of them comes back");

  // ---- the stamp, both ways, against the server clock ----------------------
  if (!/Stämpla In/.test(await stampBtn().innerText())) {
    fail(`before clocking in the button should read Stämpla In, got ${await stampBtn().innerText()}`);
  }
  log("the stamp reads Stämpla In before anything is stamped");

  // The browser is pushed a day off. A stamp taken from the device would land
  // a day out; the server's would not.
  await page.clock.setSystemTime(new Date(Date.now() + 24 * 3600e3));
  await stampBtn().click();
  await page.waitForFunction(
    () => /Stämpla Ut/.test(document.body.innerText), null, { timeout: 20000 },
  );
  log("tapping it stamps in, and the button flips to Stämpla Ut");

  const { rows } = await db.query(
    `select t.clock_in, now() - t.clock_in as age
     from public.tilldelning t
     join public.worker w on w.id = t.worker_id
     where w.name = $1 and t.clock_in is not null`, [W.name]);
  if (rows.length !== 1) fail(`expected one clocked-in row, found ${rows.length}`);
  const ageSeconds = Math.abs(Number(rows[0].age.seconds ?? 0) + Number(rows[0].age.hours ?? 0) * 3600);
  if (ageSeconds > 120) {
    fail(`the stamp is ${ageSeconds}s from the server's now(): it came from the device clock`);
  }
  log(`the stamp is the server's: ${ageSeconds}s from its now(), with the browser a day ahead`);

  await stampBtn().click();
  await page.waitForFunction(
    () => /Dina pass|Svara på pass|Stämpla In/.test(document.body.innerText),
    null, { timeout: 20000 },
  );
  log("stamping out finishes the day");

  // Put the browser clock back. It was pushed a day forward to prove the stamp
  // comes from the server, and leaving it there makes every later screen read
  // "today" as tomorrow -- which quietly emptied Nästa Pass.
  await page.clock.setSystemTime(new Date());

  // ---- the two buttons -----------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await landed(page);
  for (const [label, href] of [["Mina Pass", "/mina-pass"], ["Arbetsdagar", "/min-kalender"]]) {
    const link = page.getByRole("link", { name: label, exact: true });
    if (!(await link.count())) fail(`no "${label}" button`);
    if (!(await link.getAttribute("href"))?.includes(href)) {
      fail(`"${label}" does not point at ${href}`);
    }
  }
  log("Mina Pass and Arbetsdagar -- the latter is Min Kalender under its new name");

  // ---- Nästa Pass, above the stack ----------------------------------------
  const nasta = page.locator('a[href^="https://maps.google.com/maps?q="]');
  await nasta.waitFor({ timeout: 20000 });
  const nastaText = await nasta.innerText();
  if (!nastaText.includes(project) || !nastaText.includes(ADDRESS)) {
    fail(`the Nästa Pass card is missing the project or address: ${JSON.stringify(nastaText)}`);
  }
  try {
    await nasta.locator(".leaflet-container").waitFor({ timeout: 30000 });
  } catch {
    await shot(page, "FAILED");
    fail("the Nästa Pass card has no Leaflet map");
  }
  log("Nästa Pass: map, project, address, date, and it opens native navigation");

  // THE SPAN, AND THE FIGURE THAT MUST NOT BE THERE.
  //
  // 07:00-16:00 is /pass/ny's default and makePass leaves it alone, so this
  // is the shift's own span read back off the card.
  //
  // No hours figure, and that is the assertion with teeth. INVARIANT 10
  // masks a day's hours until an Arbetsdagbok covers the date, which a
  // coming day never has -- and on an auto-assigned leader row the pass's
  // planned_hours is not the leader's figure at all. Copying the Acceptera
  // Pass card's "07:00-16:00 · 8 h" wholesale is the mistake this catches.
  if (!nastaText.includes("07:00\u201316:00")) {
    fail(`the Nästa Pass card shows no time span: ${JSON.stringify(nastaText)}`);
  }
  const figure = nastaText.match(/\d+(?:[,.]\d+)?\s*h\b/);
  if (figure) {
    fail(`the Nästa Pass card prints an hours figure (${figure[0]}); invariant 10 masks it`);
  }
  log("span 07:00\u201316:00, and no hours figure on a day nothing has been filed for");

  // ---- the Acceptera Pass cards -------------------------------------------
  const card = page.locator('[data-offer-card="front"]');
  await card.waitFor({ timeout: 20000 });

  const [nBox, cBox] = await Promise.all([nasta.boundingBox(), card.boundingBox()]);
  if (!(nBox.y + nBox.height <= cBox.y)) {
    fail(`Nästa Pass must sit above the stack: it ends ${nBox.y + nBox.height}, stack starts ${cBox.y}`);
  }
  log("Nästa Pass sits above the Acceptera Pass stack");
  await card.first().waitFor({ timeout: 20000 });
  const text = await card.innerText();
  for (const bit of [project, ADDRESS]) {
    if (!text.includes(bit)) fail(`the card is missing ${JSON.stringify(bit)}`);
  }
  for (const label of ["Acceptera", "Neka"]) {
    if (!(await card.getByRole("button", { name: label, exact: true }).count())) {
      fail(`the card has no "${label}" button`);
    }
  }
  // NO MAP on an offer (owner, 2026-10-05): the map belongs to Nästa Pass.
  // Asserted as an absence, so a map that creeps back is caught here.
  if (await card.locator(".leaflet-container").count()) {
    await shot(page, "FAILED");
    fail("the offer card draws a map -- that belongs to Nästa Pass only");
  }
  // NO STACK ON THE HOME SCREEN, and that is the design rather than a loss.
  //
  // c75bf85 made the arbetare's startsida offer ONE pass at a time:
  // home-arbetare.tsx hands OfferStack a list of one, so the two slabs that
  // drew the pile behind the card are deliberately not there. Answering the
  // card refetches and the next offer takes its place, and the whole queue is
  // still on Acceptera Pass -- which is what the next block checks, and where
  // the stack assertions now belong.
  //
  // This expected 2 slabs and had done since 08 Sep. It went unnoticed for
  // three weeks because the run never got this far: it was timing out on a
  // calendar cell in an earlier month long before reaching the home screen.
  //
  // Asserted as a number rather than deleted. "The home screen shows one offer
  // and no pile" is a claim worth holding on to -- if a stack comes back here,
  // that is a product decision and this should be the thing that says so.
  const slabs = await page.locator("[data-stack-slab]").count();
  if (slabs !== 0) {
    await shot(page, "FAILED");
    fail(`the startsida offers one pass at a time, so it draws no stack; saw ${slabs} slabs`);
  }
  const cards = await page.locator('[data-offer-card="front"]').count();
  if (cards !== 1) fail(`expected exactly one offer card on the startsida, saw ${cards}`);
  log("one offer, no pile behind it -- the queue lives on Acceptera Pass");

  await shot(page, "w2-acceptera-kort");
  log(`card reads ${JSON.stringify(text.replace(/\n+/g, " | "))}, no map`);

  // Acceptera sits left of Neka.
  const [ax, nx] = await Promise.all([
    card.getByRole("button", { name: "Acceptera", exact: true }).boundingBox(),
    card.getByRole("button", { name: "Neka", exact: true }).boundingBox(),
  ]);
  if (!(ax.x < nx.x)) fail("Acceptera must sit left of Neka");
  log("Acceptera left, Neka right");

  // ---- Neka, and where the shift goes --------------------------------------
  const before = await card.innerText();
  await card.getByRole("button", { name: "Neka", exact: true }).click();
  await page.waitForTimeout(3000);
  const after = await page.locator('[data-offer-card="front"]').innerText();
  if (after === before) {
    await shot(page, "FAILED");
    fail("the declined card is still at the front");
  }
  log("Neka -- the card goes and the one behind it comes forward");

  await page.getByRole("button", { name: "Meny", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Meny" });
  await panel.waitFor({ timeout: 20000 });
  const items = (await panel.getByRole("link").allInnerTexts())
    .map((t) => t.replace("→", "").trim());
  if (JSON.stringify(items) !== JSON.stringify(["Öppna Pass"])) {
    fail(`menu holds ${JSON.stringify(items)}, expected ["Öppna Pass"]`);
  }

  // ---- the menu is the handoff's sheet, not the old panel -------------------
  //
  // Reading the LINKS alone would have passed just as happily against the
  // black-bordered panel this replaced, so the shape is measured too: a sheet
  // is a thing at the bottom edge with two rounded corners at the top, and
  // every one of those words is a number here.
  //
  // The sheet SLIDES, so measuring it on the frame it appeared measures it
  // mid-travel -- which is how this assertion twice "found" the sheet hanging
  // 96px below the bottom of the screen.
  //
  // Waiting on transitionend rather than on the geometry settling, because
  // both cheaper reads are wrong here. getComputedStyle().transform never
  // moves: Tailwind 4 compiles translate-y-* to the `translate` property, so
  // it reads "none" for the whole journey. And polling the rect until it holds
  // still for two frames catches the frames BEFORE the slide starts -- the
  // panel mounts at translate-y-full and flips on the next rAF -- and calls
  // the starting position the resting one.
  //
  // The timeout is a cap, not a sleep: it only runs out if the slide finished
  // before the listener was attached, which is the case where measuring
  // immediately would have been right anyway.
  await panel.evaluate((el) => new Promise((done) => {
    const cap = setTimeout(done, 1200);
    el.addEventListener("transitionend", () => { clearTimeout(cap); done(); }, { once: true });
  }));

  // getBoundingClientRect, not boundingBox(): the page is scrolled down to the
  // offer stack by now, and only the browser's own rect is viewport-relative,
  // which is the frame a fixed sheet lives in.
  const [sheetBg, sheetRadius, sheetShadow, sheetBox] = await Promise.all([
    panel.evaluate((el) => getComputedStyle(el).backgroundColor),
    panel.evaluate((el) => getComputedStyle(el).borderRadius),
    panel.evaluate((el) => getComputedStyle(el).boxShadow),
    panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { y: r.top, height: r.height };
    }),
  ]);
  const viewport = await page.evaluate(() => ({ height: window.innerHeight }));

  if (sheetBg !== "rgb(247, 246, 243)") {
    fail(`the sheet is ${sheetBg}, the Komponentspråk says #f7f6f3`);
  }
  // 22 on the two top corners and 0 on the two bottom ones -- which is what
  // makes it a sheet rising off the edge rather than a floating card.
  if (sheetRadius !== "20px 20px 0px 0px") {
    fail(`the sheet radius is ${sheetRadius}, the handoff says 20px on the top corners only`);
  }
  if (!sheetShadow.includes("rgba(36, 24, 15, 0.22)")) {
    fail(`the sheet has no upward shadow: ${sheetShadow}`);
  }
  if (Math.abs((sheetBox.y + sheetBox.height) - viewport.height) > 1) {
    fail(`the sheet ends at ${sheetBox.y + sheetBox.height}, not the viewport bottom ${viewport.height}`);
  }
  if (sheetBox.y < viewport.height / 2) {
    fail(`the sheet starts at ${sheetBox.y}, which is the top half -- it is dropping, not rising`);
  }

  // The old panel's whole vocabulary was a 2px black border. Nothing inside
  // the sheet may still be wearing one.
  const blackEdges = await panel.evaluate((el) =>
    [...el.querySelectorAll("*")].filter((n) => {
      const c = getComputedStyle(n);
      return parseFloat(c.borderTopWidth) > 0 && /rgb\(0, 0, 0\)/.test(c.borderTopColor);
    }).length);
  if (blackEdges) fail(`${blackEdges} elements in the sheet still carry a black border`);

  const closer = panel.getByRole("button", { name: "Stäng", exact: true });
  const [closeH, closeBg, closeEdge] = await Promise.all([
    closer.evaluate((el) => getComputedStyle(el).height),
    closer.evaluate((el) => getComputedStyle(el).backgroundColor),
    closer.evaluate((el) => getComputedStyle(el).borderTopColor),
  ]);
  if (closeH !== "48px") fail(`Stäng is ${closeH} tall, wanted 48 -- it steps back behind the rows`);
  // A second-rank button is white with a 1px edge, not a pale fill (Komponentspråk panel 08).
  if (closeBg !== "rgb(255, 255, 255)" || closeEdge !== "rgb(211, 209, 205)") {
    fail(`Stäng is ${closeBg} edged ${closeEdge}, wanted white with a #d3d1cd edge`);
  }

  await shot(page, "w3a-meny-sheet");
  log("the menu is the bottom sheet: #f7f6f3, radius 22 on top, on the bottom edge");

  // ---- the profile sheet, and the one thing in it that is not a link --------
  //
  // Stäng closes it, which is the reason the button is there at all -- the
  // scrim and Escape are the two exits a finger on a phone does not find.
  await closer.click();
  await panel.waitFor({ state: "detached", timeout: 20000 });

  await page.getByRole("button", { name: "Profil", exact: true }).first().click();
  const profile = page.getByRole("dialog", { name: "Profil" });
  await profile.waitFor({ timeout: 20000 });

  // ONE row, not two. Konto and Profil were separate screens asking about one
  // person -- the first held the name and the email, the second the phone
  // number and the bank account -- and they are one page now. Two menu entries
  // pointing at the same screen described a seam rather than what is there.
  const profileRows = await profile.getByRole("link").allInnerTexts();
  if (JSON.stringify(profileRows.map((t) => t.trim())) !== JSON.stringify(["Min profil"])) {
    fail(`the profile sheet holds ${JSON.stringify(profileRows)}, expected only Min profil`);
  }

  // SignOut is ui.tsx's, shared with screens still in black and white, so it
  // takes a `soft` prop rather than a redesign. Dropping that prop is a silent
  // regression -- the button still works, it just arrives wearing the old
  // language -- so the variant is asserted, not assumed.
  const ut = profile.getByRole("button", { name: "Logga ut", exact: true });
  const [utBorder, utRadius, utColour] = await Promise.all([
    ut.evaluate((el) => getComputedStyle(el).borderTopWidth),
    ut.evaluate((el) => getComputedStyle(el).borderRadius),
    ut.evaluate((el) => getComputedStyle(el).color),
  ]);
  if (parseFloat(utBorder) > 0) {
    fail(`Logga ut still carries a ${utBorder} border -- SignOut is missing its \`soft\` prop`);
  }
  // A pill since the Ro pass: the radius resolves to at least half the height.
  const utHeight = await ut.evaluate((el) => el.getBoundingClientRect().height);
  if (!(parseFloat(utRadius) >= utHeight / 2)) fail(`Logga ut radius is ${utRadius}, the design says a pill`);
  const utBg = await ut.evaluate((el) => getComputedStyle(el).backgroundColor);
  if (utBg !== "rgba(0, 0, 0, 0)") fail(`Logga ut is filled ${utBg}; in a sheet it is a text button (SignOut quiet)`);
  if (utColour !== "rgb(157, 42, 57)") {
    fail(`Logga ut is ${utColour}, the stop ink is #9d2a39`);
  }

  await shot(page, "w3b-profil-sheet");
  log("the profile sheet: Min profil, and a Logga ut in the new language");

  await profile.getByRole("button", { name: "Stäng", exact: true }).click();
  await profile.waitFor({ state: "detached", timeout: 20000 });
  await page.getByRole("button", { name: "Meny", exact: true }).click();
  await panel.waitFor({ timeout: 20000 });

  await panel.getByRole("link", { name: "Öppna Pass", exact: true }).click();
  await page.waitForURL((u) => u.pathname.includes("/oppna-pass"), { timeout: 20000 });
  await mustSee(page, project, "the shift they declined is not in Öppna Pass");
  await shot(page, "w3-oppna-pass");
  log("the declined shift is in Öppna Pass, reached from the menu");

  console.log("\nARBETARE LANDING PAGE COMPLETE.\n");
} finally {
  await browser.close();
  await db.end();
}
