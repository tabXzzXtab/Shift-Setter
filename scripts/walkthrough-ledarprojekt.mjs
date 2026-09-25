#!/usr/bin/env node
/**
 * An arbetsledare creates a project, and names somebody else responsible.
 *
 *   the two creates on the landing page · Alla Projekt in the menu · a picker
 *   that lists OTHER leaders · the project on both their screens afterwards ·
 *   an edit page that sends the leader home.
 *
 * WHY THE PICKER IS THE ASSERTION WITH TEETH. account_directory ends in
 * "is_admin() or id = auth.uid()", so before arbetsledare_roster existed a
 * leader opening this form saw exactly one name in that dropdown: their own.
 * The screen would have looked completely finished and done half of what was
 * asked -- which is the failure a browser test exists to catch, because every
 * database assertion about it passes either way.
 *
 * AND WHY BOTH SCREENS ARE CHECKED AFTERWARDS. project_staff_select is who
 * leads a project. Writing only the named leader would take the project off
 * the creator's own screen the instant they submitted the form, so the
 * creator's Alla Projekt is checked first and the named leader's second: one
 * project, two people, one of whom never touched the form.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { required } from "./env.mjs";

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

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();

console.log(`\nAn arbetsledare creates a project, at ${BASE}\n`);

try {
  // ---- two leaders, made by the admin --------------------------------------
  await signIn(page, ADMIN.email, ADMIN.password);
  log("signed in as admin");

  const A = await createPerson(page, `Ledare Ett ${RUN}`, `ledare1.${RUN}@bella.test`, "arbetsledare");
  const B = await createPerson(page, `Ledare Tva ${RUN}`, `ledare2.${RUN}@bella.test`, "arbetsledare");
  log(`created ${A.name} and ${B.name}`);

  await signOut(page);
  await signIn(page, A.email, A.password);
  await page.getByRole("button", { name: "Meny", exact: true }).waitFor({ timeout: 30000 });
  log(`signed in as ${A.name}`);

  // ---- the landing page: two creates, side by side -------------------------
  //
  // Both stay second-rank. Confirming is what this role is for, and the hero
  // above these is the count of days owed -- a create button that grew to
  // match it would say the leader's job was making things.
  for (const label of ["Skapa pass", "Nytt projekt"]) {
    const link = page.getByRole("link", { name: label, exact: true });
    if (!(await link.count())) fail(`no ${label} button on the leader's landing page`);
    const box = await link.boundingBox();
    if (Math.round(box.height) !== 60) fail(`${label} is ${box.height}px tall, wanted 60`);
    const bg = await link.evaluate((el) => getComputedStyle(el).backgroundColor);
    if (bg !== "rgb(238, 243, 254)") fail(`${label} is ${bg}, wanted the #eef3fe panel`);
  }
  await shot(page, "lp1-startsida");
  log("Skapa pass and Nytt projekt: both 60px on the #eef3fe panel, side by side");

  // Alla Projekt is in the menu now, and it has to be: a leader who creates a
  // project needs somewhere to see it that is not the form they just left.
  await page.getByRole("button", { name: "Meny", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Meny" });
  await panel.waitFor({ timeout: 20000 });
  const got = (await panel.getByRole("link").allInnerTexts())
    .map((t) => t.replace("→", "").trim()).sort();
  const expect = ["Mina Pass", "Bekräftelser", "Alla projekt"].sort();
  if (JSON.stringify(got) !== JSON.stringify(expect)) {
    fail(`menu holds ${JSON.stringify(got)}, expected ${JSON.stringify(expect)}`);
  }
  await shot(page, "lp2-meny");
  log(`menu holds exactly ${expect.join(", ")}`);
  await page.keyboard.press("Escape");

  // ---- the picker lists other people ---------------------------------------
  await page.goto(`${BASE}/projekt/ny/`, { waitUntil: "networkidle" });
  const picker = field(page, "Arbetsledare");
  await picker.waitFor({ timeout: 20000 });
  // The roster arrives after the first paint; wait for a second name rather
  // than for a timeout, so a slow fetch cannot read as a missing feature.
  await page.waitForFunction(
    () => {
      const s = document.querySelector("select");
      return s && s.options.length > 2;
    },
    { timeout: 20000 },
  ).catch(() => {});

  const names = (await picker.locator("option").allInnerTexts()).map((t) => t.trim());
  for (const who of [A.name, B.name]) {
    if (!names.includes(who)) {
      await shot(page, "FAILED");
      fail(`the Arbetsledare picker does not offer ${who} -- it holds ${JSON.stringify(names)}`);
    }
  }
  log(`the picker offers ${names.length - 1} arbetsledare, including a colleague`);

  // Their own name starts in the field: a leader creating a project is usually
  // the one who will run it. It is a default and not a lock, which the next
  // step is about to use.
  const selected = await picker.evaluate((el) => el.options[el.selectedIndex]?.text?.trim() ?? "");
  if (selected !== A.name) fail(`the picker defaults to "${selected}", wanted "${A.name}"`);
  log(`defaults to the creator: ${selected}`);

  // ---- create it, in somebody else's name ----------------------------------
  const projectName = `Ledarens Projekt ${RUN}`;
  await field(page, "Projektnamn").fill(projectName);
  await field(page, "Projektets adress").fill("Ledargatan 1, 242 30 Hörby");
  await field(page, "Beställarens adress").fill("Kundvägen 8, 241 38 Eslöv");
  await field(page, "Beställarens bolag").fill("Eslövs Fastigheter AB");
  await field(page, "Beställarens org nummer").fill("556123-4567");
  await field(page, "Tjänster").fill("Takarbete och plåt");
  await picker.selectOption({ label: B.name });
  await shot(page, "lp3-nytt-projekt");
  await page.getByRole("button", { name: "Skapa projekt" }).click();

  // The redirect is the success signal, and it is the one worth waiting for:
  // a refusal leaves the form up with a notice on it.
  await page.waitForURL(/\/projekt\/?$/, { timeout: 20000 }).catch(async () => {
    await shot(page, "FAILED");
    fail("the form did not reach Alla Projekt -- the project was refused");
  });
  log(`created "${projectName}" with ${B.name} as arbetsledare`);

  // ---- the creator still sees it -------------------------------------------
  //
  // The half that would be missing if only the named leader were written:
  // project_staff_select is who leads a project, so handing it over would take
  // it off this screen the moment the form was submitted.
  const row = page.locator(`section[data-project]:has-text("${projectName}")`);
  await row.waitFor({ timeout: 20000 }).catch(async () => {
    await shot(page, "FAILED");
    fail(`${A.name} created the project and cannot see it in Alla Projekt`);
  });
  const projectId = await row.getAttribute("data-project");
  await shot(page, "lp4-alla-projekt");
  log(`the creator sees it in Alla Projekt (${projectId})`);

  // The card is the control, and for a leader it opens ONE thing. The other
  // two are the admin's and bounce an arbetsledare back to their landing page,
  // so on a list that is mostly this leader's own projects they would be two
  // dead controls per row.
  await row.getByRole("button").first().click();
  const actions = (await row.getByRole("link").allInnerTexts()).map((t) => t.trim()).sort();
  if (JSON.stringify(actions) !== JSON.stringify(["Kolla Pass"])) {
    await shot(page, "FAILED");
    fail(`the leader's project card offers ${JSON.stringify(actions)}, wanted only Kolla Pass`);
  }
  log("the card opens Kolla Pass and nothing else -- the other two are the admin's");

  // ---- but creating is not editing -----------------------------------------
  //
  // The database is what refuses this -- a leader has INSERT on project and
  // nothing else, and LEDPROJ.creator_cannot_edit is the assertion that holds
  // it up. This is the screen saying so before they type anything.
  await page.goto(`${BASE}/projekt/redigera/?id=${projectId}`, { waitUntil: "networkidle" });
  await page.waitForURL((u) => !u.pathname.includes("redigera"), { timeout: 20000 }).catch(async () => {
    await shot(page, "FAILED");
    fail("Redigera Projekt opened for an arbetsledare; it is the admin's page");
  });
  log("Redigera Projekt sends the leader home -- editing stayed the admin's");

  // ---- and the named leader has it too -------------------------------------
  await signOut(page);
  await signIn(page, B.email, B.password);
  await page.goto(`${BASE}/projekt/`, { waitUntil: "networkidle" });
  const theirs = page.locator(`section[data-project]:has-text("${projectName}")`);
  await theirs.waitFor({ timeout: 20000 }).catch(async () => {
    await shot(page, "FAILED");
    fail(`${B.name} was named responsible and cannot see the project`);
  });
  await shot(page, "lp5-namnd-ledare");
  log(`${B.name} was named by somebody else and the project is on their screen`);

  console.log("\nARBETSLEDAREN SKAPAR PROJEKT COMPLETE.\n");
} finally {
  await browser.close();
}
