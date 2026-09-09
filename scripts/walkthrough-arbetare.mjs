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

const BASE = process.env.BASE_URL ?? "http://localhost:3000/Shift-Setter";
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
  const password = /Lösenord:\s*(\S+)/.exec(await page.locator("pre").first().innerText())?.[1];
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
    await page.locator(`[data-date="${date}"]`).waitFor({ timeout: 20000 });
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
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.waitFor({ timeout: 20000 });
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.getByRole("button", { name: "Fortsätt", exact: true }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
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

const sv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });
const today = sv.format(new Date());
// Five open days, so the stack has more behind it than it is allowed to show
// and the cap is something the test can actually see.
const OPEN = [4, 5, 6, 7, 8].map((n) => sv.format(new Date(Date.now() + n * 864e5)));

/**
 * A second held shift, two days out, and it is not decoration.
 *
 * Nästa Pass drops a shift the moment its end_time passes rather than at
 * midnight. Today's shift here runs 07:00-16:00, so from 16:00 onwards it is
 * correctly gone -- and with nothing behind it the card reads "Inga kommande
 * pass" and the assertion below fails for a reason that is the fix working.
 * A run must not depend on the hour it is started at.
 */
const SOON = sv.format(new Date(Date.now() + 2 * 864e5));
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
  await field(page, "Tjänster").fill("Stenläggning");
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

  // One unread notice, written straight in. The path that CREATES one -- an
  // admin deleting a shift someone holds -- is driven in walkthrough-kalender;
  // what is under test here is that the badge shows up in the right place.
  await db.query(
    `insert into public.notification (account_id, kind, payload)
     select w.account_id, 'shift_deleted', jsonb_build_object('work_date', $2::text)
     from public.worker w where w.name = $1`, [W.name, soon]);

  log(`a shift today for ${W.name}, ${OPEN.length} open ones, and one unread notice`);

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
  if (ground !== "rgb(243, 246, 253)") {
    fail(`the ground is ${ground}, the handoff says #f3f6fd`);
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
  if (bg !== "rgb(27, 44, 193)") {
    fail(`the primary action is ${bg} while clocked out, the handoff says #1b2cc1`);
  }
  if (!shadow.includes("rgba(27, 44, 193, 0.28)")) {
    fail(`the primary action has no accent shadow: ${shadow}`);
  }
  log("ground #f3f6fd, Inter, action 66px / radius 12 / #1b2cc1 with its shadow");


  // ---- the badge sits directly below the stamp -----------------------------
  const stampBtn = () => page.getByRole("button", { name: /Stämpla/ });
  await stampBtn().waitFor({ timeout: 20000 });

  const badge = page.getByRole("button", { name: "Okej", exact: true });
  if (!(await badge.count())) fail("no notification badge while a notice is unread");
  const [sBox, bBox] = await Promise.all([stampBtn().boundingBox(), badge.boundingBox()]);
  if (!(bBox.y > sBox.y + sBox.height)) {
    fail(`the badge is not below the stamp: stamp ends ${sBox.y + sBox.height}, badge at ${bBox.y}`);
  }
  await shot(page, "w1b-notis");
  log("the notification badge sits directly below the stamp button");

  await badge.click();
  await page.waitForTimeout(1200);
  if (await page.getByRole("button", { name: "Okej", exact: true }).count()) {
    fail("the notice came back after being dismissed");
  }
  log("dismissing it keeps it dismissed");

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
    () => /Inget pass att stämpla|Stämpla In/.test(document.body.innerText),
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
  try {
    await card.locator(".leaflet-container").waitFor({ timeout: 30000 });
  } catch {
    await shot(page, "FAILED");
    fail("the card has no Leaflet map (Nominatim may have refused the lookup)");
  }
  // THE STACK, as the redesign draws it: two slabs behind the card rather than
  // three scaled slivers. They are inset from the card's edges and sit below
  // it, so the card reads as the front of a pile without anything being
  // rotated -- a matrix(a,b,c,d,e,f) with b or c set is a rotation or a skew,
  // and there must be none.
  const slabs = page.locator("[data-stack-slab]");
  const count = await slabs.count();
  if (count !== 2) fail(`expected 2 slabs behind the front card, saw ${count}`);

  const deep = await page.locator('[data-stack-slab="deep"]').boundingBox();
  const near = await page.locator('[data-stack-slab="near"]').boundingBox();

  for (const [name, sel] of [["deep", "deep"], ["near", "near"]]) {
    const m = await page.locator(`[data-stack-slab="${sel}"]`)
      .evaluate((el) => getComputedStyle(el).transform);
    if (m !== "none") {
      const [a, b, c, d] = m.replace(/matrix\(|\)/g, "").split(",").map(Number);
      if (b !== 0 || c !== 0) fail(`the ${name} slab is rotated or skewed: ${m}`);
      if (a !== d) fail(`the ${name} slab is scaled unevenly: ${m}`);
    }
  }

  // Each is narrower than the card and centred under it, the deeper one more
  // inset than the near one -- 14px against 7px in the handoff.
  for (const [name, box] of [["deep", deep], ["near", near]]) {
    if (!(box.width < cBox.width)) fail(`the ${name} slab is not inset from the card`);
    if (Math.abs((box.x + box.width / 2) - (cBox.x + cBox.width / 2)) > 1) {
      fail(`the ${name} slab is not centred under the front card`);
    }
    if (!(box.y + box.height > cBox.y + cBox.height)) {
      fail(`the ${name} slab does not sit below the card`);
    }
  }
  if (!(deep.width < near.width)) fail("the deeper slab is not the narrower one");
  if (!(deep.y + deep.height > near.y + near.height)) {
    fail("the deeper slab does not sit lower than the near one");
  }
  log("2 slabs behind, inset and centred, the deeper one lower and narrower");

  await shot(page, "w2-acceptera-kort");
  log(`card reads ${JSON.stringify(text.replace(/\n+/g, " | "))}, with a map`);

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

  if (sheetBg !== "rgb(243, 246, 253)") {
    fail(`the sheet is ${sheetBg}, the handoff says #f3f6fd`);
  }
  // 22 on the two top corners and 0 on the two bottom ones -- which is what
  // makes it a sheet rising off the edge rather than a floating card.
  if (sheetRadius !== "22px 22px 0px 0px") {
    fail(`the sheet radius is ${sheetRadius}, the handoff says 22px on the top corners only`);
  }
  if (!sheetShadow.includes("rgba(9, 21, 64, 0.22)")) {
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
  const [closeH, closeBg] = await Promise.all([
    closer.evaluate((el) => getComputedStyle(el).height),
    closer.evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  if (closeH !== "56px") fail(`Stäng is ${closeH} tall, the handoff says 56`);
  if (closeBg !== "rgb(238, 243, 254)") {
    fail(`Stäng is ${closeBg}, the handoff says #eef3fe`);
  }

  await shot(page, "w3a-meny-sheet");
  log("the menu is the handoff's bottom sheet: #f3f6fd, radius 22 on top, on the bottom edge");

  // ---- the profile sheet, and the one thing in it that is not a link --------
  //
  // Stäng closes it, which is the reason the button is there at all -- the
  // scrim and Escape are the two exits a finger on a phone does not find.
  await closer.click();
  await panel.waitFor({ state: "detached", timeout: 20000 });

  await page.getByRole("button", { name: "Profil", exact: true }).first().click();
  const profile = page.getByRole("dialog", { name: "Profil" });
  await profile.waitFor({ timeout: 20000 });

  const profileRows = await profile.getByRole("link").allInnerTexts();
  if (JSON.stringify(profileRows.map((t) => t.trim())) !== JSON.stringify(["Konto", "Profil"])) {
    fail(`the profile sheet holds ${JSON.stringify(profileRows)}, expected Konto and Profil`);
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
  if (utRadius !== "12px") fail(`Logga ut radius is ${utRadius}, the design says 12`);
  if (utColour !== "rgb(142, 29, 21)") {
    fail(`Logga ut is ${utColour}, the design's stop ink is #8e1d15`);
  }

  await shot(page, "w3b-profil-sheet");
  log("the profile sheet: Konto, Profil, and a Logga ut in the new language");

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
