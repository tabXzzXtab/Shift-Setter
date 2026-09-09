#!/usr/bin/env node
/**
 * Drive Bekräftelser -- the screen that used to be two.
 *
 *   the renamed menu · the Att bekräfta / Historik switch · a row that opens
 *   the day it names · the admin's version of the same switch, holding stage
 *   2 · a day travelling from one view to the other through both stages.
 *
 * THE ASSERTION WITH TEETH IS THE SECOND ROW. Two days are left unconfirmed,
 * and the run taps the NEWER one. Bekräfta Pass opens on the oldest waiting
 * day unless it is asked for one by name, so a list whose rows all dropped the
 * leader at the top of the queue would still look right on the first row and
 * be a lie on every other. The test only passes if the page opens on the day
 * that was tapped.
 *
 * The other one worth having is the admin's queue. He has one now -- stage 2,
 * on the same screen under the same switch -- and the thing to prove is that
 * it is stage 2 and nothing else: a day still waiting on its arbetsledare is
 * a stage 1 claim, and the admin cannot make one (invariant 4b).
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

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
  const out = page.getByRole("button", { name: "Logga ut" });
  if (!(await out.count())) {
    // The redesigned landing pages keep Logga ut inside the profile popup.
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

/**
 * Mark one day can-work on the signed-in person's own calendar, and CHECK it.
 *
 * Read before tapping: the gesture is a toggle, so a blind retry alternates
 * between setting and clearing and the result depends on which attempt was
 * last.
 */
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

/** Create a one-slot pass on one day, hand-picking the named person. */
async function makePass(page, project, date, pick, hours) {
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
  await page.getByRole("button", { name: pick, exact: true }).click();
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "1 av 1 platser tillsatta", `the pass on ${date} did not fill with ${pick}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

const sv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });
const older = sv.format(new Date(Date.now() - 2 * 864e5));
const newer = sv.format(new Date(Date.now() - 864e5));

/** "TISDAG 9 SEP" -- what longDayHeading() puts on a row. */
const heading = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", weekday: "long",
  }).format(t).toUpperCase();
  const month = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", month: "short",
  }).format(t).replace(".", "").toUpperCase();
  return `${weekday} ${d} ${month}`;
};

const ADDRESS = "Stortorget 1, 211 22 Malmö";

console.log(`\nBekräftelser at ${BASE}\n`);

try {
  // ---- setup ---------------------------------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  const L = await createPerson(page, `Lena Ledare ${RUN}`, `bl.${RUN}@bella.test`, "arbetsledare");
  const W = await createPerson(page, `Wille Arbetare ${RUN}`, `bw.${RUN}@bella.test`, "arbetare");

  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const project = `Bekräftelser ${RUN}`;
  await field(page, "Projektnamn").fill(project);
  await field(page, "Projektets adress").fill(ADDRESS);
  await field(page, "Beställarens adress").fill("Fakturagatan 9, 111 22 Stockholm");
  await field(page, "Beställarens bolag").fill("Malmö Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Stenläggning");
  await field(page, "Startdatum").fill(older);
  await field(page, "Arbetsledare").selectOption({ label: L.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  await signOut(page);

  await signIn(page, W.email, W.password);
  await markDay(page, older);
  await markDay(page, newer);
  await signOut(page);

  await signIn(page, L.email, L.password);
  await makePass(page, project, older, W.name, "8");
  await makePass(page, project, newer, W.name, "6");
  log(`two days gone unconfirmed: ${older} and ${newer}`);

  // ---- item 1: the menu ----------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await landed(page);
  await page.getByRole("button", { name: "Meny", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Meny" });
  await panel.waitFor({ timeout: 20000 });
  const items = (await panel.getByRole("link").allInnerTexts())
    .map((t) => t.replace("→", "").trim()).sort();
  const expect = ["Arbetsdagar", "Mina Pass", "Bekräftelser"].sort();
  if (JSON.stringify(items) !== JSON.stringify(expect)) {
    fail(`menu holds ${JSON.stringify(items)}, expected ${JSON.stringify(expect)}`);
  }
  log(`menu reads ${expect.join(", ")} -- no "Min Pass Kalender", no "Bekräftelse Historik"`);

  // Arbetsdagar is the availability grid and NOT a second Mina Pass. Its mode
  // switch is the thing only that screen has.
  await panel.getByRole("link", { name: "Arbetsdagar", exact: true }).click();
  await page.waitForURL((u) => u.pathname.includes("/min-kalender"), { timeout: 20000 });
  if (!(await page.getByRole("button", { name: "Kan jobba", exact: true }).count())) {
    fail("Arbetsdagar is not the availability grid -- no Kan jobba switch");
  }
  log("Arbetsdagar opens the availability grid, the screen that writes förval");

  // ---- item 2: the switch --------------------------------------------------
  await page.goto(`${BASE}/historik/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Bekräftelser" }).waitFor({ timeout: 20000 });

  const att = page.getByRole("button", { name: "Att bekräfta", exact: true });
  const hist = page.getByRole("button", { name: "Historik", exact: true });
  if (!(await att.count()) || !(await hist.count())) fail("the two-view switch is not on the page");
  if ((await att.getAttribute("aria-pressed")) !== "true") {
    fail("Bekräftelser does not open on Att bekräfta");
  }
  log("Bekräftelser opens on Att bekräfta, with Historik one tap away");

  // ---- the rows, and the one that must open the day it names ---------------
  const rows = page.locator('a[href*="/bekrafta"]');
  await rows.first().waitFor({ timeout: 20000 });
  if ((await rows.count()) !== 2) {
    fail(`Att bekräfta lists ${await rows.count()} days, expected 2`);
  }
  const first = await rows.nth(0).innerText();
  const second = await rows.nth(1).innerText();
  if (!first.includes(heading(older))) fail(`oldest first is broken: row 1 reads ${JSON.stringify(first)}`);
  if (!second.includes(heading(newer))) fail(`row 2 reads ${JSON.stringify(second)}`);
  for (const bit of [project, W.name, "6 h"]) {
    if (!second.includes(bit)) fail(`row 2 is missing ${JSON.stringify(bit)}: ${JSON.stringify(second)}`);
  }
  await shot(page, "b1-att-bekrafta");
  log(`two days, oldest first, each naming the project, the crew and the hours`);

  // THE CONTROL. Tap the SECOND row. Bekräfta Pass opens on the oldest waiting
  // day by default, so a row that did not carry its own day would land on the
  // first one and this fails.
  await rows.nth(1).click();
  await page.waitForURL((u) => u.pathname.includes("/bekrafta"), { timeout: 20000 });
  const url = new URL(page.url());
  const projectId = url.searchParams.get("projekt");
  if (url.searchParams.get("datum") !== newer) {
    fail(`the row carries datum=${url.searchParams.get("datum")}, expected ${newer}`);
  }
  await mustSee(page, heading(newer), "the row opened a page about a different day");
  if (await page.getByText(heading(older), { exact: false }).count()) {
    fail(`tapping ${newer} opened ${older} instead -- the ask was ignored`);
  }
  await shot(page, "b4-bekrafta-ifylld");
  log(`tapping the second row opens ${newer}, not the oldest day in the queue`);

  // ---- confirming moves a day off one view without putting it on the other -
  await page.getByLabel("Vad vi gjorde").fill("Stenläggning, norra sidan.");
  await page.getByRole("button", { name: "Bekräfta dagen" }).click();
  await page.waitForTimeout(3000);

  await page.goto(`${BASE}/historik/`, { waitUntil: "networkidle" });
  await rows.first().waitFor({ timeout: 20000 });
  if ((await rows.count()) !== 1) {
    fail(`after confirming, Att bekräfta lists ${await rows.count()} days, expected 1`);
  }
  if (!(await rows.first().innerText()).includes(heading(older))) {
    fail("the confirmed day is still in Att bekräfta");
  }
  log("the confirmed day leaves Att bekräfta; the unconfirmed one stays");

  await hist.click();
  await mustSee(page, "Dagar du bekräftat visas här när admin har godkänt dem.",
    "Historik does not say where a just-confirmed day went");
  if (await page.getByText(heading(newer), { exact: false }).count()) {
    fail("a leader_confirmed day is in Historik; day_history takes it at stage 2");
  }
  await shot(page, "b2-historik-tom");
  log("Historik is honest about the gap: a confirmed day arrives when admin approves");

  await signOut(page);

  // ---- the admin's Att bekräfta is stage 2, and never stage 1 -------------
  //
  // THE CONTROL WITH TEETH. By now `newer` carries the leader's claim and
  // `older` carries nobody's. The admin's queue must hold the first and must
  // never hold the second: a day still waiting on its arbetsledare is a stage
  // 1 claim, and the admin cannot make one -- invariant 4b, and CLAUDE.md's
  // "the admin cannot make a stage 1 confirmation". Both halves are asserted,
  // because a queue that simply showed everything would pass the first.
  //
  // Scoped to OUR project by name: the admin sees every project, so another
  // fixture's day on the same date would otherwise read as ours.
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`${BASE}/historik/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Bekräftelser" }).waitFor({ timeout: 20000 });

  const adminAtt = page.getByRole("button", { name: "Att bekräfta", exact: true });
  if (!(await adminAtt.count())) fail("the admin has no Att bekräfta view; stage 2 is his queue");
  if ((await adminAtt.getAttribute("aria-pressed")) !== "true") {
    fail("the admin's Bekräftelser does not open on Att bekräfta");
  }

  const adminRows = page.locator('a[href*="/granska"]');
  await adminRows.first().waitFor({ timeout: 20000 });
  const ours = (await adminRows.allInnerTexts()).filter((t) => t.includes(project));
  if (!ours.some((t) => t.includes(heading(newer)))) {
    await shot(page, "FAILED");
    fail(`the day the leader confirmed is not in the admin's queue: ${JSON.stringify(ours)}`);
  }
  if (ours.some((t) => t.includes(heading(older)))) {
    await shot(page, "FAILED");
    fail(`${older} is still waiting on its arbetsledare and is in the admin's queue -- that is a stage 1 claim`);
  }
  await shot(page, "b5-admin-att-godkanna");
  log("the admin's queue holds the confirmed day and not the one still owed to a leader");

  // ---- stage 2, opened from the row that names the day --------------------
  //
  // Granska Pass opens on the oldest waiting day across every project, so a
  // bare visit approves whichever fixture is at the head of the queue -- this
  // test once did exactly that, going green on the admin's global log and red
  // on the leader's scoped one. The row carries its own day.
  await adminRows.filter({ hasText: heading(newer) }).filter({ hasText: project }).first().click();
  await page.waitForURL((u) => u.pathname.includes("/granska"), { timeout: 20000 });
  const godkann = page.getByRole("button", { name: /Godkänn|Bekräfta dagen/ });
  await godkann.waitFor({ timeout: 20000 });
  const head = await page.locator("main").innerText();
  if (!head.includes(project) || !head.includes(heading(newer))) {
    await shot(page, "FAILED");
    fail(`Granska Pass opened ${JSON.stringify(head.slice(0, 140))} instead of the row's own day`);
  }
  await godkann.click();
  await page.waitForTimeout(3000);
  log("the row opens that day in Granska Pass, and the admin approves it");

  // The admin's Bekräftelser opens on his queue too, so the log is one tap
  // away rather than the landing view -- what is outstanding comes first.
  await page.goto(`${BASE}/historik/`, { waitUntil: "networkidle" });
  await hist.click();
  await mustSee(page, project, "the approved day never reached the admin's Historik");
  log("approved at stage 2, the day is in the log");

  // ---- rejection sends a day back, and the two queues swap it -------------
  //
  // THIS IS WHAT MAKES "THE ADMIN'S QUEUE IS STAGE 2" FALSIFIABLE. While
  // nobody has confirmed a day it has no project_day row at all, so asserting
  // the admin is not offered it passes for free. A REJECTED day does have a
  // row -- stage null, the note on it, confirmed_at cleared by the guard --
  // and it is waiting on its arbetsledare again. That is the day that would
  // leak into the admin's queue if reviewDays() filtered on the wrong thing.
  await signOut(page);
  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/bekrafta/?projekt=${projectId}&datum=${older}`, { waitUntil: "networkidle" });
  await page.getByLabel("Vad vi gjorde").fill("Grävde för dagvatten.");
  await page.getByRole("button", { name: "Bekräfta dagen" }).click();
  await page.waitForTimeout(3000);
  log(`the leader confirmed ${older} as well`);

  await signOut(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`${BASE}/granska/?projekt=${projectId}&datum=${older}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Underkänn", exact: true }).click();
  await field(page, "Varför skickas dagen tillbaka?").fill("Timmarna stämmer inte med stämplingarna.");
  await page.getByRole("button", { name: "Skicka tillbaka till arbetsledaren" }).click();
  await page.waitForTimeout(3000);
  log("the admin sent it back with a reason");

  await page.goto(`${BASE}/historik/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Bekräftelser" }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);
  const left = (await page.locator('a[href*="/granska"]').allInnerTexts()).filter((t) => t.includes(project));
  if (left.length > 0) {
    await shot(page, "FAILED");
    fail(`a day sent back to its arbetsledare is still in the admin's queue: ${JSON.stringify(left)}`);
  }
  log("the sent-back day is out of the admin's queue -- it is stage 1 again");

  await signOut(page);
  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/historik/`, { waitUntil: "networkidle" });
  await rows.first().waitFor({ timeout: 20000 });
  if (!(await rows.first().innerText()).includes(heading(older))) {
    await shot(page, "FAILED");
    fail("the sent-back day did not return to the leader's Att bekräfta");
  }
  await rows.first().click();
  await page.waitForURL((u) => u.pathname.includes("/bekrafta"), { timeout: 20000 });
  await mustSee(page, "Timmarna stämmer inte med stämplingarna.",
                "the leader cannot see why the day came back");
  await shot(page, "b6-atersand");
  log("it is back with the leader, carrying the reason the admin gave");

  await signOut(page);
  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/historik/`, { waitUntil: "networkidle" });
  await hist.click();
  await mustSee(page, heading(newer), "the approved day never reached the leader's Historik");
  await mustSee(page, project, "the leader's Historik does not name the project");
  await shot(page, "b3-historik-fylld");
  log("and the leader reads the same log, one switch from the day still owed");

  console.log("\nBEKRÄFTELSER COMPLETE.\n");
} finally {
  await browser.close();
}
