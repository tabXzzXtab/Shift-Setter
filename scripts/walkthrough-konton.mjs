#!/usr/bin/env node
/**
 * Alla Konton -- the list that used to be a wall.
 *
 * What this proves, in a browser, against the real database:
 *
 *   1. The screen is called Alla Konton and the admin's own card is ABOVE
 *      Tillverka Konto -- geometry, not just presence, because "at the top"
 *      was the request.
 *   2. Everything the redesign removed is actually gone from a row: the Aktiv
 *      pill, the role tag, the role selector, Ändra konto, Ändra profil and
 *      Pausa kontot. A redesign is only finished when the old controls are
 *      not still there underneath it.
 *   3. The role is the section heading, and search narrows the list.
 *   4. Pressing your own card and pressing somebody else's open the SAME
 *      screen, and it holds both halves of the old pair -- the identity
 *      fields and the profile cards.
 *   5. A brand-new account is erased outright by Ta bort, and says so. That
 *      is the 'raderat' path end to end: dialog, Edge Function, RPC, list.
 *
 * Every assertion names something only the destination has. getByText matches
 * substrings, so "Konton" alone would match the heading AND the menu entry
 * that leads to it.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { required } from "./env.mjs";

/**
 * A real PNG, written by hand, because the upload path has to be given
 * something a decoder will actually accept -- and at 600x400 it also proves
 * the browser-side downscale and the centre crop, which a 1x1 placeholder
 * would step straight over.
 */
function writePng(file, w, h) {
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    // CRC-32, table-free: this runs four times per process.
    let c = ~0;
    for (const byte of td) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    crc.writeUInt32BE((~c) >>> 0);
    return Buffer.concat([len, td, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;        // bit depth
  ihdr[9] = 2;        // truecolour
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;     // filter: none
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 3;
      raw[p] = (x * 255 / w) | 0;          // a gradient, so a crop is visible
      raw[p + 1] = (y * 255 / h) | 0;
      raw[p + 2] = 160;
    }
  }
  writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]));
  return file;
}

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ART = "artifacts";
mkdirSync(ART, { recursive: true });

let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, "0")}. ${m}`);
const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };
const shot = (page, n) => page.screenshot({ path: path.join(ART, `${n}.png`), fullPage: true });

const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

/** A name nothing else in the database will collide with. */
const STAMP = Date.now().toString(36);
const NEW_NAME = `Provkonto ${STAMP}`;
const NEW_EMAIL = `provkonto.${STAMP}@probe.test`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 7"], locale: "sv-SE", timezoneId: "Europe/Stockholm",
  // Tillverka Konto is gated on Kopiera inloggning having actually copied.
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail(`page error: ${e.message}`));

console.log(`\nAlla Konton at ${BASE}\n`);

try {
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await page.locator("form").waitFor({ timeout: 20000 });
  await field(page, "E-post").fill(required("WALKTHROUGH_ADMIN_EMAIL"));
  await field(page, "Lösenord").fill(required("WALKTHROUGH_ADMIN_PASSWORD"));
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.getByRole("button", { name: "Meny", exact: true }).waitFor({ timeout: 30000 });
  log("signed in as admin");

  // ---- reached from the profile icon, under its new name --------------------
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  const pop = page.locator('[role="dialog"], [data-sheet]').first();
  await pop.waitFor({ timeout: 10000 });
  for (const gone of ["Inställningar"]) {
    if (await pop.getByRole("link", { name: gone, exact: true }).count()) {
      fail(`the profile menu still offers "${gone}"`);
    }
  }
  await pop.getByRole("link", { name: "Alla Konton", exact: true }).click();
  await page.waitForURL((u) => u.pathname.includes("/installningar"), { timeout: 20000 });
  log("profile icon opens Alla Konton, and no longer says Inställningar");

  await page.getByRole("heading", { name: "Alla Konton" }).waitFor({ timeout: 20000 });
  await page.getByRole("link", { name: /Tillverka Konto/ }).waitFor({ timeout: 20000 });

  // ---- YOUR OWN CARD, ABOVE the create button -------------------------------
  const mine = page.getByRole("link", { name: /Din profil/ }).first();
  await mine.waitFor({ timeout: 20000 });
  const mineBox = await mine.boundingBox();
  const makeBox = await page.getByRole("link", { name: /Tillverka Konto/ }).boundingBox();
  if (!mineBox || !makeBox) fail("could not measure the header cards");
  if (mineBox.y + mineBox.height > makeBox.y) {
    fail(`your own card must sit ABOVE Tillverka Konto (own ends ${
      Math.round(mineBox.y + mineBox.height)}, create starts ${Math.round(makeBox.y)})`);
  }
  log(`your own profile card sits above Tillverka Konto (${Math.round(mineBox.height)}px tall)`);

  await shot(page, "k1-alla-konton");

  // ---- what a row no longer carries -----------------------------------------
  const firstRow = page.locator("[data-konto]").first();
  await firstRow.waitFor({ timeout: 20000 });
  const rowText = (await firstRow.innerText()).replace(/\s+/g, " ");

  for (const gone of ["Aktiv", "Ändra konto", "Ändra profil", "Pausa kontot"]) {
    if (rowText.includes(gone)) fail(`a Konto row still carries "${gone}": ${rowText}`);
  }
  if (await firstRow.locator("select").count()) {
    fail("a Konto row still carries the role selector");
  }
  log(`a row is name, e-post and two controls -- no Aktiv, no selector: "${rowText}"`);

  // The whole list, not just the first row: a pill surviving on row 30 is
  // exactly the kind of thing a first-row assertion misses.
  const allRows = await page.locator("[data-konto]").count();
  const withSelect = await page.locator("[data-konto] select").count();
  if (withSelect) fail(`${withSelect} of ${allRows} rows still carry a selector`);
  log(`${allRows} rows, none of them carrying a selector`);

  // ---- the role is the heading ----------------------------------------------
  const sections = await page.locator("[data-roll]").count();
  if (sections === 0) fail("the list is not grouped by role");
  const headings = await page.locator("[data-roll] > div").first().innerText();
  if (!/·\s*\d+/.test(headings)) fail(`a section heading carries no count: "${headings}"`);
  log(`${sections} role sections, counted -- first reads "${headings.replace(/\s+/g, " ")}"`);

  // ---- 48x48 delete square, and it asks first --------------------------------
  const del = firstRow.getByRole("button", { name: /^Ta bort / });
  const delBox = await del.boundingBox();
  if (!delBox || delBox.width < 44 || delBox.height < 44) {
    fail(`the delete square is ${delBox?.width}x${delBox?.height}, under the 44px minimum`);
  }
  log(`delete square is ${Math.round(delBox.width)}x${Math.round(delBox.height)}, and named`);

  await del.click();
  const dialog = page.getByRole("dialog", { name: "Ta bort konto" });
  await dialog.waitFor({ timeout: 10000 });
  await shot(page, "k2-ta-bort-fragan");
  await dialog.getByRole("button", { name: "Avbryt" }).click();
  await dialog.waitFor({ state: "detached", timeout: 10000 });
  log("the square asks before it acts, and Avbryt leaves the row alone");

  // ---- search ----------------------------------------------------------------
  const before = await page.locator("[data-konto]").count();
  await page.getByRole("searchbox", { name: "Sök bland kontona" }).fill("zzzz-ingen-traff");
  await page.getByText("Ingen träff").waitFor({ timeout: 10000 });
  if (await page.locator("[data-konto]").count()) fail("search matched nothing but drew rows");
  await page.getByRole("searchbox", { name: "Sök bland kontona" }).fill("");
  await page.locator("[data-konto]").first().waitFor({ timeout: 10000 });
  log(`search narrows ${before} rows to none and back again`);

  // ---- your own card opens the merged screen ---------------------------------
  await mine.click();
  await page.waitForURL((u) => u.pathname.includes("/konto"), { timeout: 20000 });
  await page.getByRole("heading", { name: "Min profil" }).waitFor({ timeout: 20000 });

  // Both halves of the old pair, on one screen.
  await field(page, "Namn").waitFor({ timeout: 10000 });
  await field(page, "E-post").waitFor({ timeout: 10000 });
  for (const card of ["Kontakt", "Utbetalning", "Närmast anhörig"]) {
    if (!(await page.locator(`[data-card="${card}"]`).count())) {
      fail(`the merged screen is missing the ${card} card`);
    }
  }
  await page.getByRole("button", { name: /bild$/ }).first().waitFor({ timeout: 10000 });
  log("your own card opens one screen holding the identity fields AND the profile cards");
  await shot(page, "k3-min-profil");

  // Pausing yourself is not offered.
  if (await page.getByRole("button", { name: "Pausa kontot" }).count()) {
    fail("the screen offers to pause your own account");
  }
  log("no Pausa kontot on your own screen");

  // ---- the face: uploaded, downscaled, stored, signed and drawn --------------
  const png = writePng(path.join(ART, "provbild.png"), 600, 400);
  await page.locator('input[type="file"]').setInputFiles(png);
  await page.getByText("Bilden är sparad.").waitFor({ timeout: 40000 });

  const img = page.locator('main img').first();
  await img.waitFor({ timeout: 20000 });
  const src = await img.getAttribute("src");
  if (!src || !/^https?:/.test(src)) fail(`the avatar is not a signed URL: ${src}`);
  if (!src.includes("token=")) fail(`the avatar URL is not signed -- the bucket is private: ${src}`);
  // It has to have actually DECODED, not merely been given an src -- and the
  // signed URL is fetched after the notice appears, so this waits rather than
  // reading naturalWidth the instant the save reports.
  await img.evaluate((el) => el.complete && el.naturalWidth > 0
    ? true
    : new Promise((res, rej) => {
        el.addEventListener("load", res, { once: true });
        el.addEventListener("error", () => rej(new Error("avatar failed to load")), { once: true });
        setTimeout(() => rej(new Error("avatar never loaded")), 30000);
      }));
  const drawn = await img.evaluate((el) => el.naturalWidth);
  if (drawn < 2) fail(`the avatar never decoded (naturalWidth ${drawn})`);
  if (drawn > 512) fail(`the avatar was not downscaled: ${drawn}px from a 600x400 original`);
  log(`face uploaded, signed and drawn at ${drawn}px -- squared and downscaled from 600x400`);
  await shot(page, "k6-med-bild");

  // And it reaches the list, which signs every path in one call.
  await page.goto(`${BASE}/installningar/`, { waitUntil: "networkidle" });
  const ownImg = page.getByRole("link", { name: /Din profil/ }).locator("img").first();
  await ownImg.waitFor({ timeout: 20000 });
  await ownImg.evaluate((el) => el.complete && el.naturalWidth > 0
    ? true
    : new Promise((res, rej) => {
        el.addEventListener("load", res, { once: true });
        setTimeout(() => rej(new Error("the face never loaded in the list")), 30000);
      }));
  if (await ownImg.evaluate((el) => el.naturalWidth) < 2) {
    fail("the face does not reach Alla Konton");
  }
  log("the face reaches Alla Konton");

  // Taking it off again puts the initials back, same box.
  await page.getByRole("link", { name: /Din profil/ }).click();
  await page.getByRole("button", { name: "Ta bort bild" }).click();
  await page.getByText("Bilden är borttagen.").waitFor({ timeout: 30000 });
  if (await page.locator("main img").count()) fail("the face is still drawn after removal");
  log("removing the face puts the initials back");

  // ---- somebody else's is the same screen, plus Roll and Pausa ---------------
  await page.goBack();
  await page.locator("[data-konto]").first().waitFor({ timeout: 20000 });
  await page.locator("[data-konto] a").first().click();
  await page.waitForURL((u) => u.searchParams.get("id"), { timeout: 20000 });
  await page.getByRole("heading", { name: "Konto", exact: true }).waitFor({ timeout: 20000 });
  await field(page, "Roll").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /^(Pausa|Aktivera) kontot$/ }).waitFor({ timeout: 10000 });
  log("somebody else's card opens the same screen, with Roll and the pause on it");
  await shot(page, "k4-konto-nagon-annan");

  // ---- a brand-new account is erased outright --------------------------------
  // The fixed sequence from spec §3: name, email, THEN Kopiera inloggning --
  // which is what makes Tillverka pressable. An account whose credentials
  // nobody holds is an account nobody can use.
  await page.goto(`${BASE}/arbetare/ny/`, { waitUntil: "networkidle" });
  await field(page, "Namn").fill(NEW_NAME);
  await field(page, "E-post").fill(NEW_EMAIL);
  await page.getByRole("button", { name: /Kopiera inloggning/ }).click();
  await page.locator("[data-password]").first().waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Tillverka arbetare" }).click();
  await page.getByText("Klar", { exact: false }).first().waitFor({ timeout: 30000 });
  log(`created ${NEW_NAME}`);

  await page.goto(`${BASE}/installningar/`, { waitUntil: "networkidle" });
  await page.getByRole("searchbox", { name: "Sök bland kontona" }).waitFor({ timeout: 20000 });
  await page.getByRole("searchbox", { name: "Sök bland kontona" }).fill(NEW_NAME);
  const fresh = page.locator("[data-konto]").first();
  await fresh.waitFor({ timeout: 20000 });
  if (!(await fresh.innerText()).includes(NEW_NAME)) fail("the new account is not in the list");
  log("the new account is in the list");

  await fresh.getByRole("button", { name: /^Ta bort / }).click();
  const d2 = page.getByRole("dialog", { name: "Ta bort konto" });
  await d2.waitFor({ timeout: 10000 });
  await d2.getByRole("button", { name: "Ta bort kontot" }).click();

  // An account nothing points at is ERASED, and the notice says so without the
  // Arbetsdagbok sentence -- that clause belongs to the other outcome.
  const done = page.getByText(`${NEW_NAME} är borttagen.`, { exact: false });
  await done.waitFor({ timeout: 30000 });
  const said = await done.innerText();
  if (said.includes("arbetsdagböcker")) {
    fail(`an unused account must be erased, not shut down: "${said}"`);
  }
  if (await page.locator("[data-konto]").count()) {
    fail("the removed account is still in the list");
  }
  log(`removed, and said so: "${said.replace(/\s+/g, " ")}"`);
  await shot(page, "k5-borttaget");

  console.log("\nAll good. Artifacts in artifacts/.\n");
} catch (e) {
  await shot(page, "FAILED");
  fail(`${e.message}\n(see artifacts/FAILED.png)`);
} finally {
  await browser.close();
}
