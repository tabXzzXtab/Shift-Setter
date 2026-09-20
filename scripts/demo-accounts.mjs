#!/usr/bin/env node
/**
 * Ensure stable demo logins.
 *
 *   npm run demo:accounts
 *
 * The walkthroughs create workers with generated passwords and the maintenance
 * reset deletes every non-admin account, so anyone handed a login from a test
 * run finds it gone the next time the demo data is cleared. This creates one
 * admin, one arbetsledare and one arbetare with FIXED credentials, plus a
 * project with the leader assigned, and is idempotent -- re-running it resets
 * the passwords back to the known values rather than failing.
 *
 * The admin survives the reset on its own -- that statement deletes non-admins
 * only -- but nothing pins its PASSWORD, and a login that outlives the wipe
 * with an unknown password is not a login. So it is ensured here with the
 * other two rather than left to whatever last wrote it.
 *
 * Credentials come from .env.local, which is gitignored. This repository is
 * public; a working login committed to it is a working login for anyone.
 */
import { createClient } from "@supabase/supabase-js";
import { required, serviceRoleKey } from "./env.mjs";

const url = required("NEXT_PUBLIC_SUPABASE_URL");

// An admin holds no shifts, so it gets no worker row -- the same shape
// scripts/bootstrap-admin.mjs creates. The other two are workers as well as
// accounts (spec Section 2: an arbetsledare is a worker).
const PEOPLE = [
  { key: "DEMO_ADMIN", role: "admin", name: "Demo Admin", worker: false },
  { key: "DEMO_LEADER", role: "arbetsledare", name: "Lena Ledare", worker: true },
  { key: "DEMO_WORKER", role: "arbetare", name: "Arvid Arbetare", worker: true },
];

// Fetched for this run only, never written to .env.local: it must never reach
// a static bundle.
const service = serviceRoleKey();

const admin = createClient(url, service, { auth: { persistSession: false } });

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });

/**
 * WHICH TENANT THE DEMO DATA BELONGS TO, resolved from the demo admin rather
 * than configured separately.
 *
 * account and project are the only two tables that still default their
 * tenant_id -- every other one derives it from a parent row. Both defaults are
 * app.current_tenant_id(), which reads the CALLER'S account, and this script
 * runs on the service-role key with no auth.uid() at all. So the default
 * resolves to NULL here and the insert dies on a not-null constraint. It is
 * the same hole bootstrap-admin.mjs had, and it bites the moment demo:reset
 * deletes the non-admins and this recreates them: the update path works, the
 * insert path does not.
 *
 * Taking it from the admin's existing row keeps one fact in one place -- demo
 * data lives wherever the demo admin lives -- rather than adding a variable
 * that can disagree with DEMO_ADMIN_EMAIL.
 */
const adminEmail = required("DEMO_ADMIN_EMAIL");
const adminUser = list?.users.find((u) => u.email?.toLowerCase() === adminEmail.toLowerCase());
let TENANT = null;
if (adminUser) {
  const { data: row } = await admin
    .from("account").select("tenant_id").eq("id", adminUser.id).maybeSingle();
  TENANT = row?.tenant_id ?? null;
}
if (!TENANT) {
  console.error(
    `Cannot tell which tenant the demo data belongs to: ${adminEmail} has no account row yet.\n` +
    "Create it first, which is where the tenant is decided:\n" +
    "  node scripts/bootstrap-admin.mjs <email> <password> <tenant>");
  process.exit(1);
}

async function ensure({ key, role, name, worker }) {
  const email = required(`${key}_EMAIL`);
  const password = required(`${key}_PASSWORD`);
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  let id;
  if (existing) {
    id = existing.id;
    await admin.auth.admin.updateUserById(id, { password, email_confirm: true });
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) { console.error(`${email}: ${error.message}`); process.exit(1); }
    id = data.user.id;
  }

  const { error: aErr } = await admin
    .from("account").upsert({ id, role, active: true, tenant_id: TENANT }, { onConflict: "id" });
  if (aErr) { console.error(`${email} account: ${aErr.message}`); process.exit(1); }

  // Every worker has an account; not every account has a worker. The leader
  // and the arbetare hold shifts -- an arbetsledare is also a worker (spec
  // Section 2) -- and the admin does not.
  let workerId = null;
  if (worker) {
    const { data: w } = await admin.from("worker").select("id").eq("account_id", id).maybeSingle();
    workerId = w?.id ?? null;
    if (!workerId) {
      const { data: made, error: wErr } = await admin
        .from("worker").insert({ account_id: id, name, email }).select("id").single();
      if (wErr) { console.error(`${email} worker: ${wErr.message}`); process.exit(1); }
      workerId = made.id;
    }
  }

  console.log(`  ${role.padEnd(13)} ${email}`);
  return { id, workerId };
}

console.log("\nDemo logins:");
// Sequential, so the printed order matches PEOPLE rather than whichever call
// resolved first -- this output is read by a person handing the logins over.
const ensured = new Map();
for (const person of PEOPLE) ensured.set(person.role, await ensure(person));
const leader = ensured.get("arbetsledare");

// A project for them to work on, with the leader assigned -- without that the
// leader's project dropdown is empty and they can do nothing at all.
const NAME = "Demoprojektet";
// Scoped to the tenant: the service role sees every tenant's rows, and with
// more than one client there can be more than one Demoprojektet.
let { data: project } = await admin
  .from("project").select("id").eq("name", NAME).eq("tenant_id", TENANT).maybeSingle();
if (!project) {
  const { data, error } = await admin.from("project").insert({
    tenant_id: TENANT,
    name: NAME,
    site_address: "Storgatan 1, 242 30 Hörby",
    bestallare_address: "Kundvägen 4, 241 38 Eslöv",
    bestallare_bolag: "Eslövs Fastigheter AB",
    bestallare_orgnr: "556123-4567",
    services: "Bygg och plåt",
    start_date: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date()),
  }).select("id").single();
  if (error) { console.error(`project: ${error.message}`); process.exit(1); }
  project = data;
}

await admin.from("project_leader")
  .upsert({ project_id: project.id, account_id: leader.id }, { onConflict: "project_id,account_id" });

console.log(`\n  project      ${NAME} (arbetsledare assigned)`);
console.log(`\nPasswords are in .env.local. Re-run this after any demo reset.\n`);
