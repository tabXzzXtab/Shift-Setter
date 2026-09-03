#!/usr/bin/env node
/**
 * Ensure stable demo logins.
 *
 *   npm run demo:accounts
 *
 * The walkthroughs create workers with generated passwords and the maintenance
 * reset deletes every non-admin account, so anyone handed a login from a test
 * run finds it gone the next time the demo data is cleared. This creates one
 * arbetsledare and one arbetare with FIXED credentials, plus a project with the
 * leader assigned, and is idempotent -- re-running it resets the passwords back
 * to the known values rather than failing.
 *
 * Credentials come from .env.local, which is gitignored. This repository is
 * public; a working login committed to it is a working login for anyone.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { required, ROOT } from "./env.mjs";

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const ref = required("SUPABASE_PROJECT_REF");

const PEOPLE = [
  { key: "DEMO_LEADER", role: "arbetsledare", name: "Lena Ledare" },
  { key: "DEMO_WORKER", role: "arbetare", name: "Arvid Arbetare" },
];

// Fetched for this run only, never written to .env.local: it must never reach
// a static bundle.
const out = execFileSync(
  process.execPath,
  [path.join(ROOT, "node_modules/supabase/dist/supabase.js"),
   "projects", "api-keys", "--project-ref", ref],
  { encoding: "utf8", env: process.env },
);
const service = JSON.parse(out.slice(out.indexOf("{")))
  .keys.find((k) => k.id === "service_role").api_key;

const admin = createClient(url, service, { auth: { persistSession: false } });

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });

async function ensure({ key, role, name }) {
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
    .from("account").upsert({ id, role, active: true }, { onConflict: "id" });
  if (aErr) { console.error(`${email} account: ${aErr.message}`); process.exit(1); }

  // Every worker has an account; not every account has a worker. Both of these
  // hold shifts -- an arbetsledare is also a worker (spec Section 2).
  const { data: w } = await admin.from("worker").select("id").eq("account_id", id).maybeSingle();
  let workerId = w?.id;
  if (!workerId) {
    const { data: made, error: wErr } = await admin
      .from("worker").insert({ account_id: id, name, email }).select("id").single();
    if (wErr) { console.error(`${email} worker: ${wErr.message}`); process.exit(1); }
    workerId = made.id;
  }

  console.log(`  ${role.padEnd(13)} ${email}`);
  return { id, workerId };
}

console.log("\nDemo logins:");
const [leader] = await Promise.all([ensure(PEOPLE[0])]);
const worker = await ensure(PEOPLE[1]);

// A project for them to work on, with the leader assigned -- without that the
// leader's project dropdown is empty and they can do nothing at all.
const NAME = "Demoprojektet";
let { data: project } = await admin.from("project").select("id").eq("name", NAME).maybeSingle();
if (!project) {
  const { data, error } = await admin.from("project").insert({
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
