#!/usr/bin/env node
/**
 * UI audit capture: every screen, per role, reached by pressing the thing a
 * person presses. Files are named {role}_{entry-action}_{screen-name}.png.
 *
 *   node ui-audit/capture.mjs                  all three roles + signed out
 *   node ui-audit/capture.mjs admin ledare     just those
 *
 * READ ONLY AGAINST THE LIVE DATABASE. Every request that would write is
 * refused in the browser before it leaves: PATCH/PUT/DELETE, POST to a table,
 * POST to a write RPC, every Edge Function, every storage write. The one
 * exception is the Arbetsdagbok insert, which is answered with a fake 201 so
 * the preview can render from real reads without a document being filed --
 * a filed document releases hours to workers (invariant 10).
 *
 * Logs in as the stable demo accounts from .env.local (DEMO_ADMIN_*,
 * DEMO_LEADER_*, DEMO_WORKER_*). 390x844 @2x, full page, like
 * scripts/screenshots.mjs.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { required } from "../scripts/env.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
// FOLD=<dir> writes viewport-only captures there instead: the first screen a
// phone shows, which is what the audit judges on a list hundreds of rows long.
const FOLD = process.env.FOLD ?? "";
const OUT = FOLD || "ui-audit";
mkdirSync(OUT, { recursive: true });

const CREDS = {
  admin:        { email: required("DEMO_ADMIN_EMAIL"),  pw: required("DEMO_ADMIN_PASSWORD") },
  arbetsledare: { email: required("DEMO_LEADER_EMAIL"), pw: required("DEMO_LEADER_PASSWORD") },
  arbetare:     { email: required("DEMO_WORKER_EMAIL"), pw: required("DEMO_WORKER_PASSWORD") },
};

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ROLES = wanted.length ? wanted : ["alla", "admin", "arbetsledare", "arbetare"];

const manifest = [];
const failed = [];
const blocked = [];

// ---- the write guard -------------------------------------------------------
const WRITE_RPCS = new Set([
  "register_push_token", "forget_push_token", "replace_leader", "make_worker_ansvarig",
  "leave_day_unsupervised", "complete_bristsurvey", "clock_in", "clock_out",
  "accept_offer", "decline_offer", "avboka_pass", "place_replacement", "delete_pass",
  "swap_leaders", "exit_tenant", "enter_tenant", "confirm_flagged_day", "approve_day",
  "reject_day", "close_pass", "create_snabb_pass", "fill_passes", "delete_project",
  "delete_account",
]);

async function guard(ctx) {
  await ctx.route(/\/(rest|functions|storage)\/v1\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = req.method();
    const p = url.pathname;
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return route.continue();

    if (p.startsWith("/rest/v1/rpc/")) {
      const fn = p.slice("/rest/v1/rpc/".length);
      if (!WRITE_RPCS.has(fn)) return route.continue();
    }
    if (m === "POST" && p === "/rest/v1/arbetsdagbok") {
      blocked.push(`faked 201 ${m} ${p}`);
      return route.fulfill({ status: 201, body: "", headers: { "content-type": "application/json" } });
    }
    blocked.push(`${m} ${p}`);
    console.log(`  BLOCKED write ${m} ${p}`);
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "blocked by ui-audit capture (read-only run)" }),
    });
  });
}

// ---- helpers -----------------------------------------------------------------
const field = (page, label) =>
  page.locator(`label:has(span:text-is("${label}"))`).locator("input, textarea, select").first();

async function settle(page, ms = 700) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(ms);
}

async function hideDevChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button],
              #__next-build-watcher { display: none !important; }`,
  }).catch(() => {});
}

async function shot(page, role, entry, screen, note = "") {
  await settle(page);
  await hideDevChrome(page);
  const name = `${role}_${entry}_${screen}`;
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !FOLD });
  const u = new URL(page.url());
  manifest.push({ name, role, entry, screen, url: u.pathname + u.search, note });
  console.log(`  ok   ${name}.png  (${u.pathname}${u.search})`);
}

/** One capture. Never throws. */
async function step(page, role, entry, screen, fn, note) {
  try {
    await fn();
    await shot(page, role, entry, screen, note);
    return true;
  } catch (e) {
    const why = String(e?.message ?? e).split("\n")[0].slice(0, 160);
    failed.push({ name: `${role}_${entry}_${screen}`, why });
    console.log(`  FAIL ${role}_${entry}_${screen} -- ${why}`);
    return false;
  }
}

const home = async (page) => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Meny", exact: true }).waitFor({ timeout: 30000 });
};
const menu = async (page, label) => {
  await home(page);
  await page.getByRole("button", { name: "Meny", exact: true }).click();
  await page.getByRole("link", { name: label, exact: true }).last().click();
  await page.waitForLoadState("networkidle");
};
const profil = async (page, label) => {
  await home(page);
  await page.getByRole("button", { name: "Profil", exact: true }).click();
  await page.getByRole("link", { name: label, exact: true }).last().click();
  await page.waitForLoadState("networkidle");
};
const tap = async (page, locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box to tap");
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
};

const iphone14 = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "sv-SE",
  timezoneId: "Europe/Stockholm",
  permissions: ["clipboard-read", "clipboard-write"],
};

async function signIn(browser, role) {
  const ctx = await browser.newContext({ ...iphone14 });
  await guard(ctx);
  const page = await ctx.newPage();
  const { email, pw } = CREDS[role];
  await page.goto(`${BASE}/login/`, { waitUntil: "networkidle" });
  await page.locator("form").waitFor({ timeout: 30000 });
  await field(page, "E-post").fill(email);
  await field(page, "Lösenord").fill(pw);
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
  await page.getByRole("button", { name: "Meny", exact: true }).waitFor({ timeout: 30000 });
  return { ctx, page };
}

/** Shared by admin and arbetsledare: the two-screen Skapa pass flow. */
async function skapaPass(page, role) {
  await step(page, role, "pressed-skapa-pass", "vilka-dagar", async () => {
    await home(page);
    await page.getByRole("link", { name: "Skapa pass" }).first().click();
    await page.locator("[data-date]").first().waitFor({ timeout: 20000 });
  });
  await step(page, role, "pressed-fortsatt", "vad-behovs", async () => {
    const cells = page.locator("[data-date]");
    const n = await cells.count();
    await tap(page, cells.nth(Math.min(n - 3, 20)));
    await page.getByRole("button", { name: "Fortsätt", exact: true }).click({ timeout: 20000 });
    await page.getByRole("heading", { name: "Beskriv passen" }).waitFor({ timeout: 20000 });
  });
}

const browser = await chromium.launch();
console.log(`\nUI audit capture at ${BASE} -- 390x844 @2x, full page, writes blocked\n`);

/* ========================================================================== */
/* SIGNED OUT                                                                 */
/* ========================================================================== */
if (ROLES.includes("alla")) {
  console.log("SIGNED OUT");
  const ctx = await browser.newContext({ ...iphone14 });
  await guard(ctx);
  const page = await ctx.newPage();
  await step(page, "alla", "opened-app-signed-out", "logga-in", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.locator("form").waitFor({ timeout: 30000 });
  });
  await step(page, "alla", "pressed-glomt-losenord", "glomt-losenord", async () => {
    await page.getByRole("link", { name: /Glömt lösenord/ }).click();
    await page.getByRole("heading", { name: "Återställ lösenordet" }).waitFor({ timeout: 20000 });
  });
  await ctx.close();
}

/* ========================================================================== */
/* ADMIN                                                                      */
/* ========================================================================== */
if (ROLES.includes("admin")) {
  console.log("ADMIN");
  const R = "admin";
  const { ctx, page } = await signIn(browser, R);

  await step(page, R, "logged-in", "startsida", () => home(page));

  await step(page, R, "pressed-meny", "meny-sheet", async () => {
    await home(page);
    await page.getByRole("button", { name: "Meny", exact: true }).click();
    await page.getByRole("link", { name: "Alla Projekt", exact: true }).waitFor({ timeout: 10000 });
  });

  await step(page, R, "pressed-profil-ikon", "profil-sheet", async () => {
    await home(page);
    await page.getByRole("button", { name: "Profil", exact: true }).click();
    await page.getByRole("link", { name: "Alla Konton", exact: true }).waitFor({ timeout: 10000 });
  });

  await step(page, R, "pressed-projekt-rad", "startsida-projekt-oppet", async () => {
    await home(page);
    await page.locator("[data-project] > button").first().click();
    await page.getByRole("link", { name: "Generera Arbetsdagbok" }).first().waitFor({ timeout: 10000 });
  });

  await step(page, R, "pressed-nytt-projekt", "nytt-projekt", async () => {
    await home(page);
    await page.getByRole("link", { name: "Nytt projekt" }).first().click();
    await page.getByRole("heading", { name: "Skapa ett projekt" }).waitFor({ timeout: 20000 });
  });

  await skapaPass(page, R);

  await step(page, R, "pressed-snabb-pass", "snabb-pass", async () => {
    await home(page);
    await page.getByRole("link", { name: "Snabb pass" }).first().click();
    await page.getByRole("heading", { name: "Sätt in någon på ett pass" }).waitFor({ timeout: 20000 });
  });
  // Före is the selected mode on arrival, so the shot above already is it.
  await step(page, R, "pressed-efter-bekraftelse", "snabb-pass-efter", async () => {
    await page.getByRole("button", { name: "Efter bekräftelse" }).click({ timeout: 10000 });
  });
  await step(page, R, "chose-ny-arbetare-i-vem", "snabb-pass-ny-arbetare", async () => {
    await field(page, "Vem?").selectOption({ label: "+ Ny arbetare…" });
    await page.getByRole("heading", { name: "Skapa ett konto" }).waitFor({ timeout: 10000 });
  });

  // ---- the project's three errands ----
  const openFirstProject = async () => {
    await home(page);
    await page.locator("[data-project] > button").first().click();
  };

  await step(page, R, "pressed-generera-arbetsdagbok", "arbetsdagbok-valj-period", async () => {
    await openFirstProject();
    await page.getByRole("link", { name: "Generera Arbetsdagbok" }).first().click();
    await page.getByRole("heading", { name: "Skapa arbetsdagboken" }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
  });

  // Press Generera: either the bristsurvey opens (read-only until its own
  // button), or the insert is faked and the preview renders.
  try {
    await page.getByRole("button", { name: "Generera Arbetsdagbok" }).click({ timeout: 10000 });
    await page.waitForTimeout(3000);
    await settle(page);
    const preview = await page.getByRole("button", { name: "Ladda ner PDF" }).count();
    // The survey opens on its warning step: a Nej/Ja pair, nothing written.
    const survey = await page.getByRole("button", { name: "Ja", exact: true }).count();
    if (preview) await shot(page, R, "pressed-generera", "arbetsdagbok-preview", "insert faked");
    else if (survey) await shot(page, R, "pressed-generera", "bristsurvey-varning", "gaps in default period");
    else await shot(page, R, "pressed-generera", "arbetsdagbok-efter-generera", "neither preview nor survey");
  } catch (e) {
    failed.push({ name: `${R}_pressed-generera`, why: String(e?.message ?? e).slice(0, 160) });
  }

  await step(page, R, "pressed-redigera-projekt", "redigera-projekt", async () => {
    await openFirstProject();
    await page.getByRole("link", { name: "Redigera Projekt" }).first().click();
    await page.getByRole("heading", { name: "Ändra projektet" }).waitFor({ timeout: 20000 });
  });

  await step(page, R, "pressed-kolla-pass", "projektets-pass", async () => {
    await openFirstProject();
    await page.getByRole("link", { name: "Kolla Pass" }).first().click();
    await page.waitForURL((u) => u.pathname.startsWith("/pass"), { timeout: 20000 });
    await page.waitForTimeout(1200);
  });

  // ---- Meny ----
  await step(page, R, "pressed-meny-kalender", "skiftkalender", async () => {
    await menu(page, "Kalender");
    await page.getByRole("heading", { name: "Välj en dag" }).waitFor({ timeout: 20000 });
  });
  await step(page, R, "pressed-personlig", "personlig-kalender", async () => {
    await page.getByRole("button", { name: "Personlig", exact: true }).click();
    await page.getByRole("heading", { name: "Lägg in ett ärende" }).waitFor({ timeout: 20000 });
  });

  // A day with shifts on it: the first cell carrying a project stripe.
  await step(page, R, "pressed-kalenderdag", "oppna-dag", async () => {
    await menu(page, "Kalender");
    await page.getByRole("heading", { name: "Välj en dag" }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1000);
    const links = page.locator('a[href*="/dag"]');
    const n = await links.count();
    let chosen = null;
    for (let i = 0; i < n; i++) {
      const l = links.nth(i);
      if (await l.locator("[title]").count()) { chosen = l; break; }
    }
    await (chosen ?? links.first()).click();
    await page.waitForURL((u) => u.pathname.startsWith("/dag"), { timeout: 20000 });
    await page.waitForTimeout(1500);
  });

  // A pass block opens the project's day, where the per-pass actions live.
  await step(page, R, "pressed-passblock", "projektets-dag", async () => {
    await page.locator("[data-pass-block]").first().click({ timeout: 10000 });
    await page.waitForURL((u) => u.pathname.startsWith("/dag/projekt"), { timeout: 20000 });
    await page.waitForTimeout(1500);
  });
  const dagUrl = page.url();

  await step(page, R, "pressed-andra-detta-pass", "oppna-dag-andra-pass", async () => {
    await page.getByRole("button", { name: "Ändra detta pass" }).first().click({ timeout: 10000 });
  });

  await step(page, R, "pressed-avboka-pass-arbetsledare", "vem-tar-over", async () => {
    await page.goto(dagUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Avboka Pass — / }).first().click({ timeout: 10000 });
    await page.getByRole("dialog").first().waitFor({ timeout: 15000 });
  });

  await step(page, R, "pressed-byta-plats-med-arbetsledare", "byta-plats", async () => {
    await page.goto(dagUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Byta Plats Med Arbetsledare — / }).first().click({ timeout: 8000 });
    await page.getByRole("dialog").first().waitFor({ timeout: 15000 });
  });

  await step(page, R, "pressed-lagg-till", "lagg-till", async () => {
    await page.goto(dagUrl.replace("/dag/projekt", "/dag"), { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Lägg till" }).click({ timeout: 10000 });
    await page.getByRole("heading", { name: "Lägg till" }).waitFor({ timeout: 15000 });
  });

  await step(page, R, "pressed-arende", "tilldela-arende", async () => {
    await page.getByRole("link", { name: /^Ärende/ }).click({ timeout: 10000 });
    await page.getByRole("heading", { name: "Lägg in ett ärende" }).waitFor({ timeout: 15000 });
  });

  await step(page, R, "pressed-meny-alla-projekt", "alla-projekt", async () => {
    await menu(page, "Alla Projekt");
    await page.locator("[data-project]").first().waitFor({ timeout: 20000 });
  });
  await step(page, R, "pressed-projektkort", "alla-projekt-kort-oppet", async () => {
    await page.locator("[data-project] > button").first().click();
    await page.getByRole("link", { name: "Kolla Pass" }).first().waitFor({ timeout: 10000 });
  });

  await step(page, R, "pressed-meny-bekraftelser", "bekraftelser-att-godkanna", async () => {
    await menu(page, "Bekräftelser");
    await page.getByRole("heading", { name: "Välj en dag att granska" }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
  });
  const hasReview = await page.locator('a[href*="/granska"]').count();
  if (hasReview) {
    await step(page, R, "pressed-dag-att-godkanna", "granska-pass", async () => {
      await page.locator('a[href*="/granska"]').first().click();
      await page.waitForURL((u) => u.pathname.startsWith("/granska"), { timeout: 20000 });
      await page.waitForTimeout(1500);
    });
  } else {
    failed.push({ name: `${R}_pressed-dag-att-godkanna_granska-pass`, why: "no leader-confirmed day waiting" });
  }
  await step(page, R, "pressed-historik", "bekraftelser-historik", async () => {
    await menu(page, "Bekräftelser");
    await page.getByRole("button", { name: "Historik" }).click();
    await page.waitForTimeout(1200);
  });

  // ---- Profil sheet ----
  await step(page, R, "pressed-min-profil", "min-profil", async () => {
    await profil(page, "Min profil");
    await page.getByRole("heading", { name: "Uppdatera dina uppgifter" }).waitFor({ timeout: 20000 });
  });
  await step(page, R, "pressed-alla-konton", "alla-konton", async () => {
    await profil(page, "Alla Konton");
    await page.locator("[data-konto]").first().waitFor({ timeout: 20000 });
  });
  await step(page, R, "pressed-kontorad", "konto-annan-person", async () => {
    await page.locator("[data-konto] a").first().click();
    await page.waitForURL((u) => u.searchParams.get("id"), { timeout: 20000 });
    await page.waitForTimeout(1200);
  });
  await step(page, R, "pressed-tillverka-konto", "ny-arbetare", async () => {
    await profil(page, "Alla Konton");
    await page.getByRole("link", { name: "Tillverka Konto" }).click();
    await field(page, "Namn").waitFor({ timeout: 20000 });
  });
  await step(page, R, "pressed-kopiera-inloggning", "ny-arbetare-inloggning-kopierad", async () => {
    await field(page, "Namn").fill("Skärmbild Person");
    await field(page, "E-post").fill("skarmbild.person@example.se");
    await page.getByRole("button", { name: /Kopiera inloggning/ }).click();
    await page.locator("[data-password]").first().waitFor({ timeout: 20000 });
  });

  await ctx.close();
}

/* ========================================================================== */
/* ARBETSLEDARE                                                               */
/* ========================================================================== */
if (ROLES.includes("arbetsledare")) {
  console.log("ARBETSLEDARE");
  const R = "arbetsledare";
  const { ctx, page } = await signIn(browser, R);

  await step(page, R, "logged-in", "startsida", () => home(page));
  await step(page, R, "pressed-meny", "meny-sheet", async () => {
    await home(page);
    await page.getByRole("button", { name: "Meny", exact: true }).click();
    await page.getByRole("dialog").first().waitFor({ timeout: 10000 });
  });
  await step(page, R, "pressed-profil-ikon", "profil-sheet", async () => {
    await home(page);
    await page.getByRole("button", { name: "Profil", exact: true }).click();
    await page.getByRole("link", { name: "Min profil", exact: true }).waitFor({ timeout: 10000 });
  });

  await step(page, R, "pressed-bekrafta-pass", "bekrafta-pass", async () => {
    await home(page);
    await page.getByRole("link", { name: "Bekräfta pass" }).click();
    await page.getByRole("heading", { name: "Bekräfta dagen" }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
  });

  await skapaPass(page, R);

  await step(page, R, "pressed-nytt-projekt", "nytt-projekt", async () => {
    await home(page);
    await page.getByRole("link", { name: "Nytt projekt" }).first().click();
    await page.getByRole("heading", { name: "Skapa ett projekt" }).waitFor({ timeout: 20000 });
  });

  await step(page, R, "pressed-mina-pass", "mina-pass-kommande", async () => {
    await home(page);
    await page.getByRole("link", { name: "Mina Pass", exact: true }).first().click();
    await page.getByRole("heading", { name: "Se dina pass" }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
  });
  await step(page, R, "pressed-kalender-flik", "mina-pass-kalender", async () => {
    await page.getByRole("button", { name: "Kalender", exact: true }).click();
  });
  await step(page, R, "pressed-tillganglighet-flik", "mina-pass-tillganglighet", async () => {
    await page.getByRole("button", { name: "Tillgänglighet", exact: true }).click();
    await page.locator("[data-date]").first().waitFor({ timeout: 20000 });
  });

  await step(page, R, "pressed-bekraftelser", "bekraftelser-att-bekrafta", async () => {
    await home(page);
    await page.getByRole("link", { name: "Bekräftelser", exact: true }).first().click();
    await page.getByRole("heading", { name: "Välj en dag att bekräfta" }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
  });
  await step(page, R, "pressed-historik", "bekraftelser-historik", async () => {
    await page.getByRole("button", { name: "Historik" }).click();
    await page.waitForTimeout(1200);
  });

  await step(page, R, "pressed-alla-projekt", "alla-projekt", async () => {
    await home(page);
    await page.getByRole("link", { name: "Alla projekt", exact: true }).first().click();
    await page.waitForTimeout(1200);
  });
  // A leader's card is the link to Kolla Pass itself; there is nothing to open.
  await step(page, R, "pressed-projektkort", "projektets-pass", async () => {
    await page.locator("[data-project] a").first().click();
    await page.waitForURL((u) => u.pathname.startsWith("/pass"), { timeout: 20000 });
    await page.waitForTimeout(1200);
  });

  await step(page, R, "pressed-min-profil", "min-profil", async () => {
    await profil(page, "Min profil");
    await page.getByRole("heading", { name: "Uppdatera dina uppgifter" }).waitFor({ timeout: 20000 });
  });

  await ctx.close();
}

/* ========================================================================== */
/* ARBETARE                                                                   */
/* ========================================================================== */
if (ROLES.includes("arbetare")) {
  console.log("ARBETARE");
  const R = "arbetare";
  const { ctx, page } = await signIn(browser, R);

  await step(page, R, "logged-in", "startsida", async () => {
    await home(page);
    await page.waitForTimeout(1500);
  });
  await step(page, R, "pressed-meny", "meny-sheet", async () => {
    await home(page);
    await page.getByRole("button", { name: "Meny", exact: true }).click();
    await page.getByRole("link", { name: "Öppna Pass", exact: true }).waitFor({ timeout: 10000 });
  });
  await step(page, R, "pressed-profil-ikon", "profil-sheet", async () => {
    await home(page);
    await page.getByRole("button", { name: "Profil", exact: true }).click();
    await page.getByRole("link", { name: "Min profil", exact: true }).waitFor({ timeout: 10000 });
  });

  await step(page, R, "pressed-visa-alla", "acceptera-pass", async () => {
    await home(page);
    await page.getByRole("link", { name: /Visa alla/ }).click({ timeout: 8000 });
    await page.getByRole("heading", { name: "Välj ditt pass" }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
  });

  await step(page, R, "pressed-mina-pass", "mina-pass-kommande", async () => {
    await home(page);
    await page.getByRole("link", { name: "Mina Pass", exact: true }).first().click();
    await page.getByRole("heading", { name: "Se dina pass" }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
  });
  await step(page, R, "pressed-kalender-flik", "mina-pass-kalender", async () => {
    await page.getByRole("button", { name: "Kalender", exact: true }).click();
  });
  await step(page, R, "pressed-tillganglighet-flik", "mina-pass-tillganglighet", async () => {
    await page.getByRole("button", { name: "Tillgänglighet", exact: true }).click();
    await page.locator("[data-date]").first().waitFor({ timeout: 20000 });
  });

  await step(page, R, "pressed-arbetsdagar", "min-kalender", async () => {
    await home(page);
    await page.getByRole("link", { name: "Arbetsdagar", exact: true }).first().click();
    await page.locator("[data-date]").first().waitFor({ timeout: 20000 });
  });

  await step(page, R, "pressed-meny-oppna-pass", "oppna-pass", async () => {
    await menu(page, "Öppna Pass");
    await page.getByRole("heading", { name: "Boka ett ledigt pass" }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
  });

  await step(page, R, "pressed-min-profil", "min-profil", async () => {
    await profil(page, "Min profil");
    await page.getByRole("heading", { name: "Uppdatera dina uppgifter" }).waitFor({ timeout: 20000 });
  });

  await ctx.close();
}

await browser.close();

writeFileSync(path.join(OUT, "manifest.json"),
  JSON.stringify({ base: BASE, taken: manifest, failed, blocked }, null, 2));

console.log(`\n${"=".repeat(60)}`);
console.log(`SAVED ${manifest.length}`);
if (failed.length) {
  console.log(`\nNOT CAPTURED ${failed.length}`);
  for (const f of failed) console.log(`  ${f.name}: ${f.why}`);
}
if (blocked.length) {
  console.log(`\nWRITES BLOCKED ${blocked.length}`);
  for (const b of blocked) console.log(`  ${b}`);
}
console.log("=".repeat(60));
