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
  await page.getByRole("button", { name: /Klar, / }).click();
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
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

const sv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });
const today = sv.format(new Date());
// Five open days, so the stack has more behind it than it is allowed to show
// and the cap is something the test can actually see.
const OPEN = [4, 5, 6, 7, 8].map((n) => sv.format(new Date(Date.now() + n * 864e5)));
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
  await signOut(page);

  await signIn(page, L.email, L.password);
  await makePass(page, project, today, "8", W.name);
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
  // The stack: at most three slivers, each lower and smaller than the one in
  // front, and no rotation anywhere. A matrix(a,b,c,d,e,f) with b or c set is
  // a rotation or a skew, which is exactly what this layout must not have.
  const slivers = page.locator('[aria-hidden="true"].absolute.border-2');
  const count = await slivers.count();
  if (count !== 3) fail(`expected 3 slivers behind the front card, saw ${count}`);

  let lastBottom = 0, lastScale = 1;
  for (let i = 0; i < count; i++) {
    const m = await slivers.nth(i).evaluate((el) => getComputedStyle(el).transform);
    const [a, b, c, d, , f] = m.replace(/matrix\(|\)/g, "").split(",").map(Number);
    if (b !== 0 || c !== 0) fail(`sliver ${i} is rotated or skewed: ${m}`);
    if (a !== d) fail(`sliver ${i} is scaled unevenly: ${m}`);
    if (!(a < 1 && a >= 0.8)) fail(`sliver ${i} scale ${a} is outside one step per layer`);
    if (!(f > 0)) fail(`sliver ${i} is not offset downward: ${m}`);

    const box = await slivers.nth(i).boundingBox();
    if (Math.abs((box.x + box.width / 2) - (cBox.x + cBox.width / 2)) > 1) {
      fail(`sliver ${i} is not centred under the front card`);
    }
    // Deepest is drawn first, so walking the DOM walks FORWARD through the
    // stack: each one sits a step higher and a step larger than the last,
    // which is the same rule as "each card behind is lower and smaller".
    if (i > 0) {
      if (!(box.y + box.height < lastBottom)) fail("the slivers do not step downward");
      if (!(a > lastScale)) fail("the slivers do not grow toward the front");
    }
    lastBottom = box.y + box.height;
    lastScale = a;
  }
  log(`${count} slivers behind, stepped down and centred, none rotated`);

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
