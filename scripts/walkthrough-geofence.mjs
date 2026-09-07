#!/usr/bin/env node
/**
 * The 4 km geofence on Stämpla In / Stämpla Ut.
 *
 * Three paths, all driven with a real browser position:
 *
 *   permission refused   -> blocked, told to allow location sharing
 *   50 km away           -> blocked, told how far away they are
 *   on the site          -> stamped, and the stamp is the server's as before
 *
 * The site is Bruksgatan 8 in Hörby, which is the address of the one real
 * project in this database and one Nominatim actually places. The run asserts
 * that it still does, first -- an address that stopped geocoding would make
 * the "too far" case fall through to fail-open and the test would pass while
 * proving nothing.
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

const sv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });
const TODAY = sv.format(new Date());

async function reach(page, date) {
  for (let i = 0; i < 24; i++) {
    if (await page.locator(`[data-date="${date}"]`).count()) return;
    await page.getByRole("button", { name: "Nästa månad", exact: true }).click();
    await page.waitForTimeout(350);
  }
  fail(`could not page the calendar to ${date}`);
}

async function tap(page, date) {
  const cell = page.locator(`[data-date="${date}"]`);
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

/** Read before tapping: the calendar gesture is a toggle. */
async function markDay(page, date) {
  const marked = () => page.locator(`[data-date="${date}"][aria-label*="kan jobba"]`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
    await reach(page, date);
    await page.waitForTimeout(800);
    if (await marked().count()) return;
    await page.getByRole("button", { name: "Kan jobba", exact: true }).click();
    await tap(page, date);
    await page.waitForTimeout(2000);
  }
  fail(`could not mark ${date}`);
}

/** The stamp button, whatever it currently says. */
const stampButton = (page) =>
  page.locator("button").filter({ hasText: /Stämpla In|Stämpla Ut|Söker plats…|Stämplar…/ }).first();

const browser = await chromium.launch();

// SITE is the coordinate Nominatim gives for Bruksgatan in Hörby; FAR is put
// roughly 50 km north-east of it, well outside any plausible reading of 4 km.
const SITE = { latitude: 55.85725, longitude: 13.66010 };
const FAR = { latitude: 56.20000, longitude: 14.10000 };

const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
  geolocation: SITE,
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

console.log(`\nGeofence at ${BASE}\n`);

try {
  // ---- the address must still geocode, or the rest proves nothing ---------
  const ADDRESS = "Bruksgatan 8, 242 30 Hörby";
  const placed = await page.evaluate(async (q) => {
    const r = await fetch(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(q),
      { headers: { Accept: "application/json" } },
    );
    const b = await r.json();
    return b[0] ? { lat: Number(b[0].lat), lon: Number(b[0].lon), category: b[0].category } : null;
  }, ADDRESS);

  if (!placed || placed.category === "boundary") {
    fail(`Nominatim no longer places "${ADDRESS}" precisely (${JSON.stringify(placed)}). ` +
         `Every case below would fall through to fail-open and pass for the wrong reason.`);
  }
  log(`Nominatim places ${ADDRESS} at ${placed.lat.toFixed(4)},${placed.lon.toFixed(4)} (${placed.category})`);

  // ---- setup: a shift today, on that address ------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  const L = await createPerson(page, `Gustav Ledare ${RUN}`, `gl.${RUN}@bella.test`, "arbetsledare");
  const W = await createPerson(page, `Greta ${RUN}`, `gw.${RUN}@bella.test`, "arbetare");

  const P = `Geo ${RUN}`;
  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  await field(page, "Projektnamn").fill(P);
  await field(page, "Projektets adress").fill(ADDRESS);
  await field(page, "Beställarens adress").fill("Kundvägen 4, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Bygg");
  await field(page, "Startdatum").fill(TODAY);
  await field(page, "Arbetsledare").selectOption({ label: L.name });
  await page.getByRole("button", { name: "Skapa projekt" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/projekt/"), { timeout: 20000 });
  await signOut(page);

  await signIn(page, W.email, W.password);
  await markDay(page, TODAY);
  await signOut(page);

  await signIn(page, L.email, L.password);
  await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
  await page.getByText("Vilka dagar?").waitFor({ timeout: 20000 });
  await reach(page, TODAY);
  await tap(page, TODAY);
  await page.getByRole("button", { name: /Klar, / }).click();
  await page.getByText("Vad behövs?").waitFor({ timeout: 20000 });
  await field(page, "Projekt").selectOption({ label: P });
  await field(page, "Börjar").fill("00:00");
  await field(page, "Slutar").fill("23:59");
  await page.getByLabel("Timmar på rad 1").fill("8");
  await page.getByRole("button", { name: W.name, exact: true }).click();
  await page.getByRole("button", { name: /Skapa 1 pass/ }).click();
  await mustSee(page, "1 av 1 platser tillsatta", "the shift was not created");
  await signOut(page);
  log(`${W.name} has a shift today on ${P}, at ${ADDRESS}`);

  // ---- 1. permission refused ---------------------------------------------
  await ctx.clearPermissions();
  await signIn(page, W.email, W.password);
  await stampButton(page).waitFor({ timeout: 20000 });
  await stampButton(page).click();
  await mustSee(page, "Du måste tillåta platsdelning för att stämpla in.",
    "a refused position did not block the stamp");
  await shot(page, "gf1-nekad-plats");
  log("with location refused the stamp is blocked, and says why");

  // Nothing was written: the button still offers to stamp IN.
  const afterDenied = await page.locator("main").innerText();
  if (!afterDenied.includes("Du har inte stämplat in.")) {
    await shot(page, "FAILED");
    fail(`a blocked stamp still wrote something: ${JSON.stringify(afterDenied.slice(0, 200))}`);
  }
  log("and nothing was written -- the shift is still not stamped in");

  // ---- 2. allowed, but far away -------------------------------------------
  await ctx.grantPermissions(["geolocation"]);
  await ctx.setGeolocation(FAR);
  await page.reload({ waitUntil: "networkidle" });
  await stampButton(page).click();
  await mustSee(page, "Du är för långt från arbetsplatsen",
    "a stamp from 50 km away was not blocked");
  await mustSee(page, "Du måste vara inom 4 km för att stämpla in.",
    "the refusal does not state the rule");

  const far = await page.locator("main").innerText();
  const km = /för långt från arbetsplatsen \((\d+[.,]\d) km\)/.exec(far)?.[1];
  if (!km) fail(`the refusal does not name a distance: ${JSON.stringify(far.slice(0, 300))}`);
  if (Number(km.replace(",", ".")) < 10) {
    fail(`the distance reads ${km} km from 50 km away; it is measuring against the wrong point`);
  }
  await shot(page, "gf2-for-langt");
  log(`from 50 km away the stamp is blocked and the message names the distance (${km} km)`);

  if (!far.includes("Du har inte stämplat in.")) {
    fail("a stamp blocked by distance still wrote something");
  }

  // ---- 3. on the site -----------------------------------------------------
  await ctx.setGeolocation(SITE);
  await page.reload({ waitUntil: "networkidle" });
  await stampButton(page).click();
  await mustSee(page, "Du är instämplad.", "a stamp from the site was blocked");
  await shot(page, "gf3-instamplad");
  log("standing on the site the stamp goes through, unchanged");

  // ---- 4. and Stämpla Ut is gated the same way ----------------------------
  await ctx.setGeolocation(FAR);
  await page.reload({ waitUntil: "networkidle" });
  await stampButton(page).waitFor({ timeout: 20000 });
  const outLabel = await stampButton(page).innerText();
  if (!outLabel.includes("Stämpla Ut")) {
    fail(`expected the button to offer Stämpla Ut, got ${JSON.stringify(outLabel)}`);
  }
  await stampButton(page).click();
  await mustSee(page, "Du är för långt från arbetsplatsen",
    "Stämpla Ut is not gated; someone could stamp out from home");
  const stillIn = await page.locator("main").innerText();
  if (!stillIn.includes("Du är instämplad.")) {
    fail("a blocked Stämpla Ut still wrote something");
  }
  await shot(page, "gf4-ut-nekad");
  log("Stämpla Ut is gated too -- the drive home is not the end of the shift");

  console.log("\nGEOFENCE COMPLETE.\n");
} finally {
  await browser.close();
}
