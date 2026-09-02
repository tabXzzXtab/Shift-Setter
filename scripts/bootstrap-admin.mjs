#!/usr/bin/env node
/**
 * Create the founding admin account.
 *
 *   node scripts/bootstrap-admin.mjs <email> <password>
 *
 * Every other account is created through the create-account Edge Function,
 * which requires an admin caller. This is the one that cannot be, so it is
 * applied the same way schema is: by the single database writer, deliberately,
 * and never from the browser.
 *
 * Idempotent: re-running promotes the existing account rather than failing.
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { required, ROOT } from "./env.mjs";
import path from "node:path";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: node scripts/bootstrap-admin.mjs <email> <password>");
  process.exit(1);
}

const ref = required("SUPABASE_PROJECT_REF");
const url = required("NEXT_PUBLIC_SUPABASE_URL");

// The service-role key is never written to .env.local: it is fetched for this
// one run and lives only in memory. It must never reach a static bundle.
const out = execFileSync(
  process.execPath,
  [path.join(ROOT, "node_modules/supabase/dist/supabase.js"),
   "projects", "api-keys", "--project-ref", ref],
  { encoding: "utf8", env: process.env },
);
const service = JSON.parse(out.slice(out.indexOf("{")))
  .keys.find((k) => k.id === "service_role").api_key;

const admin = createClient(url, service, { auth: { persistSession: false } });

// Find or create the auth user.
let userId;
const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (existing) {
  userId = existing.id;
  await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
  console.log(`Auth user already existed: ${email} (password reset)`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) { console.error(error.message); process.exit(1); }
  userId = data.user.id;
  console.log(`Created auth user: ${email}`);
}

const { error: acctErr } = await admin
  .from("account")
  .upsert({ id: userId, role: "admin", active: true }, { onConflict: "id" });
if (acctErr) { console.error(acctErr.message); process.exit(1); }

console.log(`Account ${userId} is an active admin.`);

const { count } = await admin
  .from("account")
  .select("id", { count: "exact", head: true })
  .eq("role", "admin")
  .eq("active", true);
console.log(`Active admins: ${count}`);
