#!/usr/bin/env node
/**
 * Every screen in the app, as a phone would draw it.
 *
 *   node scripts/screenshots.mjs                 all three roles
 *   node scripts/screenshots.mjs admin ledare    just those
 *
 * 390x844 (iPhone 14) at 2x, full page. Output to screenshots/.
 *
 * A SHOT NEVER ABORTS THE RUN. Forty-odd captures across three logins is too
 * long a chain for one bad selector to cost the other forty; each is tried,
 * failures are collected with their reason, and the summary at the end says
 * exactly which ones need another pass. A run that dies at shot nine tells you
 * nothing about shots ten to forty.
 *
 * Credentials come from TEMP_* in the environment -- scripts/temp-accounts.mjs
 * prints them once and stores them nowhere, so they are passed in rather than
 * read from a file.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const CREDS = {
  admin:   { email: process.env.TEMP_ADMIN_EMAIL,    pw: process.env.TEMP_ADMIN_PW },
  ledare:  { email: process.env.TEMP_LEDARE_EMAIL,   pw: process.env.TEMP_LEDARE_PW },
  arbetare:{ email: process.env.TEMP_ARBETARE_EMAIL, pw: process.env.TEMP_ARBETARE_PW },
  // A Korperation super admin: a different tenancy from the other three, which
  // is the whole point of the shots it takes.
  super:   { email: process.env.TEMP_SUPER_EMAIL,    pw: process.env.TEMP_SUPER_PW },
};

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ROLES = wanted.length ? wanted : ["admin", "ledare", "arbetare"];

const saved = [];
const failed = [];

const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

/** Let webfonts and any map tiles settle, so two runs of the same screen match. */
async function settle(page, ms = 700) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(ms);
}

/**
 * The dev server paints its own badge over the bottom-left of every page, and
 * in a full-page capture it lands in the middle of the content. It is not part
 * of the design, so it does not belong in a picture of the design.
 */
async function hideDevChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button],
              #__next-build-watcher { display: none !important; }`,
  }).catch(() => {});
}

async function shot(page, name) {
  await settle(page);
  await hideDevChrome(page);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  saved.push(`${name}.png`);
  console.log(`  ok   ${name}.png`);
}

/**
 * ONLY=name,name narrows a run to those shots.
 *
 * Retaking one screen must not rewrite the rest of its role: the files around
 * it were captured from a different account, or a different clock state, and
 * quietly replacing them makes the set disagree with itself.
 */
const ONLY = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const wants = (name) => ONLY.length === 0 || ONLY.includes(name);

/** One capture. Never throws -- a failure is recorded and the run continues. */
async function step(page, name, fn) {
  if (!wants(name)) return;
  try {
    await fn();
    await shot(page, name);
  } catch (e) {
    failed.push({ name, why: (e.message ?? String(e)).split("\n")[0].slice(0, 160) });
    console.log(`  FAIL ${name}.png -- ${(e.message ?? e).split("\n")[0].slice(0, 120)}`);
    // Leave the browser somewhere sane so the next shot is not also poisoned.
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
}

async function signIn(ctx, role) {
  const { email, pw } = CREDS[role];
  if (!email || !pw) throw new Error(`no credentials for ${role}`);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await page.locator("form").waitFor({ timeout: 20000 });
  await field(page, "E-post").fill(email);
  await field(page, "Lösenord").fill(pw);
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
  // The role is read from the database on every load, so the page renders
  // "Laddar…" first. Waiting for the bar is waiting for the account to arrive.
  await page.getByRole("button", { name: "Meny", exact: true }).waitFor({ timeout: 30000 });
  return page;
}

const iphone14 = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "sv-SE",
  timezoneId: "Europe/Stockholm",
};

const browser = await chromium.launch();

/** The date the seeded shifts sit on, Stockholm. */
const sv = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });
const TODAY = sv.format(new Date());
const YESTERDAY = sv.format(new Date(Date.now() - 864e5));
/** The project the seeded shifts hang off, so the confirm screen can be opened
 *  straight at the day rather than hunted for. */
const PROJ = process.env.SEED_PROJECT ?? "";

console.log(`\nScreenshots at ${BASE} -- 390x844 @2x, full page\n`);

/* ========================================================================== */
/* ADMIN                                                                      */
/* ========================================================================== */
if (ROLES.includes("admin")) {
  console.log("ADMIN");
  const ctx = await browser.newContext({ ...iphone14 });
  const page = await signIn(ctx, "admin");

  await step(page, "admin-startsida", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Meny", exact: true }).waitFor({ timeout: 20000 });
  });

  await step(page, "admin-startsida-meny-open", async () => {
    await page.getByRole("button", { name: "Meny", exact: true }).click();
    await page.getByRole("link", { name: "Alla Projekt", exact: true }).waitFor({ timeout: 10000 });
  });

  await step(page, "admin-alla-projekt", async () => {
    await page.goto(`${BASE}/projekt/`, { waitUntil: "networkidle" });
    await page.locator("[data-project]").first().waitFor({ timeout: 20000 });
  });

  await step(page, "admin-alla-projekt-card-expanded", async () => {
    await page.locator("[data-project]").first().click();
    await page.getByRole("link", { name: /Redigera Projekt/i }).first().waitFor({ timeout: 10000 });
  });

  await step(page, "admin-redigera-projekt", async () => {
    await page.getByRole("link", { name: /Redigera Projekt/i }).first().click();
    await page.waitForURL((u) => u.pathname.includes("/projekt/redigera"), { timeout: 20000 });
    await page.getByRole("heading", { name: "Redigera projekt" }).waitFor({ timeout: 20000 });
  });

  await step(page, "admin-kolla-pass", async () => {
    await page.goto(`${BASE}/projekt/`, { waitUntil: "networkidle" });
    await page.locator("[data-project]").first().click();
    await page.getByRole("link", { name: /Kolla Pass/i }).first().click();
    await page.waitForURL((u) => u.pathname.includes("/pass"), { timeout: 20000 });
  });

  await step(page, "admin-kalender-arbete", async () => {
    await page.goto(`${BASE}/kalender/`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Skiftkalender" }).waitFor({ timeout: 20000 });
  });

  await step(page, "admin-kalender-personlig", async () => {
    await page.getByRole("button", { name: "Personlig", exact: true }).click();
    await page.getByRole("heading", { name: "Personlig kalender" }).waitFor({ timeout: 20000 });
  });

  await step(page, "admin-kalender-dag-open", async () => {
    await page.goto(`${BASE}/dag/?datum=${TODAY}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Tilldela Ärende" }).waitFor({ timeout: 20000 });
  });

  await step(page, "admin-dag-tilldela-arende-form", async () => {
    await page.getByRole("button", { name: "Tilldela Ärende" }).click();
    await page.waitForTimeout(900);
  });

  // The list with something in it: an ärende that exists is a different screen
  // from the button that would make one.
  await step(page, "admin-dag-tilldela-arende", async () => {
    await page.goto(`${BASE}/dag/?datum=${TODAY}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Tilldela Ärende" }).click();
    await field(page, "Titel").fill("Leverans betong");
    await field(page, "Beskrivning").fill("Betongbil kommer 09:00, grind 2.");
    await page.getByRole("button", { name: "Spara ärende" }).click();
    await page.getByText("Ärendet är sparat", { exact: false }).waitFor({ timeout: 20000 });
    // Re-read the day so the ärende is drawn in the list rather than only
    // reported by the notice above it.
    await page.goto(`${BASE}/dag/?datum=${TODAY}`, { waitUntil: "networkidle" });
    await page.getByText("Leverans betong", { exact: false }).first().waitFor({ timeout: 20000 });
  });

  await step(page, "admin-snabb-pass-fore", async () => {
    await page.goto(`${BASE}/snabb/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Före bekräftelse" }).click();
    await page.waitForTimeout(600);
  });

  await step(page, "admin-snabb-pass-efter", async () => {
    await page.getByRole("button", { name: "Efter bekräftelse" }).click();
    await page.waitForTimeout(600);
  });

  await step(page, "admin-bekraftelser-att-bekrafta", async () => {
    await page.goto(`${BASE}/historik/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Att bekräfta" }).click();
    await page.waitForTimeout(800);
  });

  await step(page, "admin-bekraftelser-historik", async () => {
    await page.getByRole("button", { name: "Historik" }).click();
    await page.waitForTimeout(800);
  });

  await step(page, "admin-konto-hantering", async () => {
    await page.goto(`${BASE}/installningar/`, { waitUntil: "networkidle" });
    await page.locator("[data-konto]").first().waitFor({ timeout: 20000 });
  });

  await step(page, "admin-konto-hantering-search", async () => {
    await page.getByRole("searchbox", { name: "Sök bland kontona" }).fill("temp");
    await page.waitForTimeout(600);
  });

  await step(page, "admin-tillverka-konto-step1", async () => {
    await page.goto(`${BASE}/arbetare/ny/`, { waitUntil: "networkidle" });
    await field(page, "Namn").waitFor({ timeout: 20000 });
  });

  await step(page, "admin-tillverka-konto-step2-copied", async () => {
    await field(page, "Namn").fill("Skärmbild Person");
    await field(page, "E-post").fill(`skarmbild.${Date.now().toString(36)}@bellaservice.se`);
    await page.getByRole("button", { name: /Kopiera inloggning/ }).click();
    await page.locator("[data-password]").first().waitFor({ timeout: 20000 });
  });

  await step(page, "admin-profil-egen", async () => {
    await page.goto(`${BASE}/konto/`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Min profil" }).waitFor({ timeout: 20000 });
  });

  await step(page, "admin-profil-annan-anvandare", async () => {
    await page.goto(`${BASE}/installningar/`, { waitUntil: "networkidle" });
    const search = page.getByRole("searchbox", { name: "Sök bland kontona" });
    await search.waitFor({ timeout: 20000 });
    await search.fill("Arvid");
    const row = page.locator("[data-konto]").first();
    await row.waitFor({ timeout: 20000 });
    await row.locator("a").first().click();
    await page.waitForURL((u) => u.searchParams.get("id"), { timeout: 20000 });
    await page.getByRole("heading", { name: "Konto", exact: true }).waitFor({ timeout: 20000 });
  });

  await ctx.close();

  // Signed out, so it gets its own context: the recovery screen is reached
  // from the login page and an authenticated session never sees it.
  try {
    if (!wants("admin-glomt-losenord")) throw { skip: true };
    const anon = await browser.newContext({ ...iphone14 });
    const p2 = await anon.newPage();
    await p2.goto(`${BASE}/glomt-losenord/`, { waitUntil: "networkidle" });
    await p2.getByRole("heading", { name: "Glömt lösenord" }).waitFor({ timeout: 20000 });
    await shot(p2, "admin-glomt-losenord");
    await anon.close();
  } catch (e) {
    if (e && e.skip) { /* narrowed out by ONLY */ }
    else {
    failed.push({ name: "admin-glomt-losenord", why: (e.message ?? String(e)).slice(0, 160) });
    console.log(`  FAIL admin-glomt-losenord.png -- ${String(e.message ?? e).slice(0, 120)}`);
    }
  }
}

/* ========================================================================== */
/* ARBETSLEDARE                                                               */
/* ========================================================================== */
if (ROLES.includes("ledare")) {
  console.log("ARBETSLEDARE");
  const ctx = await browser.newContext({ ...iphone14 });
  const page = await signIn(ctx, "ledare");

  await step(page, "ledare-startsida", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Meny", exact: true }).waitFor({ timeout: 20000 });
  });

  await step(page, "ledare-startsida-meny-open", async () => {
    await page.getByRole("button", { name: "Meny", exact: true }).click();
    await page.getByRole("link", { name: "Mina Pass", exact: true }).first().waitFor({ timeout: 10000 });
  });

  await step(page, "ledare-skapa-pass-kalender", async () => {
    await page.goto(`${BASE}/pass/ny/`, { waitUntil: "networkidle" });
    await page.locator("[data-date]").first().waitFor({ timeout: 20000 });
  });

  await step(page, "ledare-skapa-pass-form", async () => {
    const cells = page.locator("[data-date]");
    const n = await cells.count();
    const cell = cells.nth(Math.min(n - 3, 20));
    const b = await cell.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    // Painting a day reveals the count and Fortsätt; Fortsätt is what actually
    // opens the form. Waited for rather than caught-and-ignored: a swallowed
    // failure here photographs the picker under the form's filename.
    await page.getByRole("button", { name: "Fortsätt", exact: true }).click({ timeout: 20000 });
    await page.getByRole("heading", { name: "Vad behövs?" }).waitFor({ timeout: 20000 });
  });

  await step(page, "ledare-bekrafta-pass-active", async () => {
    await page.goto(`${BASE}/bekrafta/?projekt=${PROJ}&datum=${YESTERDAY}`,
                    { waitUntil: "networkidle" });
    await page.locator('[data-row][data-running="0"]').first().waitFor({ timeout: 20000 });
  });

  await step(page, "ledare-bekrafta-pass-dimmed", async () => {
    // Same screen, a day that has NOT ended: every row draws at opacity .4 and
    // its fields are disabled until the shift is over.
    await page.goto(`${BASE}/bekrafta/?projekt=${PROJ}&datum=${TODAY}`,
                    { waitUntil: "networkidle" });
    await page.locator('[data-row][data-running="1"]').first().waitFor({ timeout: 20000 });
  });

  await step(page, "ledare-bekraftelser-att-bekrafta", async () => {
    await page.goto(`${BASE}/historik/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Att bekräfta" }).click();
    await page.waitForTimeout(800);
  });

  await step(page, "ledare-bekraftelser-historik", async () => {
    await page.getByRole("button", { name: "Historik" }).click();
    await page.waitForTimeout(800);
  });

  await step(page, "ledare-mina-pass-lista", async () => {
    await page.goto(`${BASE}/mina-pass/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Kommande Pass", exact: true }).click();
    await page.waitForTimeout(700);
  });

  await step(page, "ledare-mina-pass-kalender", async () => {
    await page.getByRole("button", { name: "Kalender", exact: true }).click();
    await page.waitForTimeout(700);
  });

  await step(page, "ledare-arbetsdagar", async () => {
    await page.goto(`${BASE}/min-kalender/`, { waitUntil: "networkidle" });
    await page.locator("[data-date]").first().waitFor({ timeout: 20000 });
  });

  await step(page, "ledare-profil", async () => {
    await page.goto(`${BASE}/konto/`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Min profil" }).waitFor({ timeout: 20000 });
  });

  await ctx.close();
}

/* ========================================================================== */
/* ARBETARE                                                                   */
/* ========================================================================== */
if (ROLES.includes("arbetare")) {
  console.log("ARBETARE");
  const ctx = await browser.newContext({ ...iphone14 });
  const page = await signIn(ctx, "arbetare");

  /*
   * THE LANDING PAGE IS THE SAME SCREEN IN TWO CLOCK STATES, so it takes two
   * passes with a database write between them, and the two passes must not
   * overwrite each other's work: capturing "Stämpla In" while the worker is
   * clocked in photographs the wrong button under the right filename. Which
   * half runs is decided by CLOCKED_IN, set by the caller alongside the write.
   *
   * The stamp is seeded rather than pressed because Stämpla In is geofenced to
   * 4 km of the site, and a mocked position photographs no better than a
   * written one.
   */
  if (process.env.CLOCKED_IN === "1") {
    await step(page, "arbetare-startsida-stampla-ut", async () => {
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Stämpla Ut/i }).waitFor({ timeout: 20000 });
    });
  } else {
    await step(page, "arbetare-startsida-stampla-in", async () => {
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Stämpla In/i }).waitFor({ timeout: 20000 });
    });

    await step(page, "arbetare-startsida-acceptera-stack", async () => {
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Acceptera/i }).first().waitFor({ timeout: 20000 });
    });
  }

  /*
   * The stack lives ON the landing page, so a full-page capture of
   * "startsida-acceptera-stack" is the same picture as "startsida-stampla-in" --
   * one screen, one file, byte for byte. This is the offer screen proper, which
   * is genuinely a different thing to look at.
   */
  await step(page, "arbetare-acceptera-pass", async () => {
    await page.goto(`${BASE}/acceptera/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
  });

  await step(page, "arbetare-mina-pass-lista", async () => {
    await page.goto(`${BASE}/mina-pass/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Kommande Pass", exact: true }).click();
    await page.waitForTimeout(700);
  });

  await step(page, "arbetare-mina-pass-kalender", async () => {
    await page.getByRole("button", { name: "Kalender", exact: true }).click();
    await page.waitForTimeout(700);
  });

  await step(page, "arbetare-oppna-pass", async () => {
    await page.goto(`${BASE}/oppna-pass/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
  });

  await step(page, "arbetare-profil", async () => {
    await page.goto(`${BASE}/konto/`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Min profil" }).waitFor({ timeout: 20000 });
  });

  await ctx.close();
}

/* ========================================================================== */
/* SUPER ADMIN -- the operator's view, which is a different tenancy entirely   */
/* ========================================================================== */
if (ROLES.includes("super")) {
  console.log("SUPER ADMIN");
  const ctx = await browser.newContext({ ...iphone14 });
  const page = await signIn(ctx, "super");
  const TARGET = process.env.SUPER_TENANT ?? "Bella Service AB";

  await step(page, "super-tenant-list", async () => {
    await page.goto(`${BASE}/super/`, { waitUntil: "networkidle" });
    await page.locator("[data-tenant]").first().waitFor({ timeout: 20000 });
  });

  /*
   * ENTERING IS A DATABASE ACT, not a client-side pretence: enter_tenant()
   * writes a row that app.is_acting() reads, and that suppresses the
   * super-admin bypass so the operator sees the client's rows and only those.
   * So this shot has to be taken after a real round trip, and the session has
   * to be left OUT of the tenancy afterwards -- an operator left acting is a
   * changed database row, not a stale screen.
   */
  await step(page, "super-acting-as-admin", async () => {
    await page.goto(`${BASE}/super/`, { waitUntil: "networkidle" });
    await page.locator(`[data-enter="${TARGET}"]`).click({ timeout: 20000 });
    await page.waitForURL((u) => !u.pathname.includes("/super"), { timeout: 30000 });

    // A FRESH LOAD, not the client-side navigation Gå in leaves you on. The
    // banner reads the acting row when it mounts, and entering does not remount
    // it -- so straight after the click the page is already scoped to the
    // client's data while still showing no banner saying so. Waiting for
    // "Lämna" before reloading waits for something that will never arrive.
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Lämna" }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Meny", exact: true }).waitFor({ timeout: 30000 });
  });

  // Leave, whatever happened above.
  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const leave = page.getByRole("button", { name: "Lämna" });
    if (await leave.count()) {
      await leave.click();
      await leave.waitFor({ state: "detached", timeout: 20000 });
      console.log("  ..   left the tenancy again");
    }
  } catch {
    console.log("  WARN could not confirm the tenancy was left -- check /super");
  }

  await ctx.close();
}

await browser.close();

console.log(`\n${"=".repeat(60)}`);
console.log(`SAVED ${saved.length}`);
for (const s of saved) console.log(`  ${s}`);
if (failed.length) {
  console.log(`\nFAILED ${failed.length}`);
  for (const f of failed) console.log(`  ${f.name}: ${f.why}`);
}
console.log("=".repeat(60));
