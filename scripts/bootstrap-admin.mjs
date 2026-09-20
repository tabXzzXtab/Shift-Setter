#!/usr/bin/env node
/**
 * Create an admin account inside a tenant.
 *
 *   node scripts/bootstrap-admin.mjs <email> <password> <tenant>
 *
 * <tenant> is a tenant id or its exact name, e.g. "Bella Service AB".
 *
 * Every other account is created through the create-account Edge Function,
 * which requires an admin caller in the same tenant. This is the one that
 * cannot be -- a tenant with no admin yet has nobody to authorise the first
 * one -- so it is applied the same way schema is: by the single database
 * writer, deliberately, and never from the browser.
 *
 * THE TENANT IS AN ARGUMENT BECAUSE THIS RUNS AS THE SERVICE ROLE, which has
 * no auth.uid(). account.tenant_id defaults to app.current_tenant_id(), and
 * that resolves to NULL here, so the insert fails on the not-null constraint
 * with nothing to explain why. There is no sensible default: nothing about a
 * service-role connection says which company it is acting for, and guessing is
 * how one client's administrator ends up inside another's.
 *
 * It does NOT grant super_admin. That flag belongs to Korperation's own staff,
 * it is guarded in the database against exactly this kind of side door, and an
 * operator is a different thing from a client's administrator.
 *
 * Idempotent: re-running resets the password and promotes the existing account.
 * It REFUSES to move an account that already belongs to a different tenant --
 * see the note at that check.
 */
import { createClient } from "@supabase/supabase-js";
import { required, serviceRoleKey } from "./env.mjs";

const [email, password, tenantArg] = process.argv.slice(2);
if (!email || !password || !tenantArg) {
  console.error("usage: node scripts/bootstrap-admin.mjs <email> <password> <tenant>");
  console.error('  <tenant> is a tenant id or its exact name, e.g. "Bella Service AB"');
  process.exit(1);
}

const url = required("NEXT_PUBLIC_SUPABASE_URL");

// The service-role key is never written to .env.local: it is fetched for this
// one run and lives only in memory. It must never reach a static bundle.
const service = serviceRoleKey();

const admin = createClient(url, service, { auth: { persistSession: false } });

// ---- which tenant --------------------------------------------------------
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantArg);
const { data: tenant, error: tErr } = await admin
  .from("tenant")
  .select("id, name, account_type")
  .eq(isUuid ? "id" : "name", tenantArg)
  .maybeSingle();

if (tErr) { console.error(tErr.message); process.exit(1); }
if (!tenant) {
  console.error(`No tenant matches ${tenantArg}.`);
  const { data: all } = await admin.from("tenant").select("id, name").order("name");
  for (const t of all ?? []) console.error(`  ${t.id}  ${t.name}`);
  process.exit(1);
}
console.log(`Tenant: ${tenant.name} (${tenant.account_type})`);

// ---- find or create the auth user ----------------------------------------
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

/**
 * MOVING A TENANT IS NOT THIS SCRIPT'S JOB, and a silent upsert would make it
 * one. The row's profile, notifications and personal_event rows each carry a
 * composite key demanding they agree with their account's tenant, so a move is
 * a deferred multi-statement transaction -- not a column overwrite. Doing it
 * here by accident would either fail on a constraint with an unreadable
 * message, or succeed and strand the children.
 */
const { data: prior } = await admin
  .from("account")
  .select("tenant_id")
  .eq("id", userId)
  .maybeSingle();

if (prior && prior.tenant_id !== tenant.id) {
  console.error(
    `${email} already exists in a different tenant (${prior.tenant_id}).\n` +
    "Moving an account between tenants is a migration, not a bootstrap: its\n" +
    "profile and notifications have to travel with it under deferred\n" +
    "constraints. Refusing rather than half-doing it.");
  process.exit(1);
}

const { error: acctErr } = await admin
  .from("account")
  .upsert({ id: userId, role: "admin", active: true, tenant_id: tenant.id },
          { onConflict: "id" });
if (acctErr) { console.error(acctErr.message); process.exit(1); }

console.log(`Account ${userId} is an active admin in ${tenant.name}.`);

const { count } = await admin
  .from("account")
  .select("id", { count: "exact", head: true })
  .eq("role", "admin")
  .eq("active", true)
  .eq("tenant_id", tenant.id);
console.log(`Active admins in ${tenant.name}: ${count}`);
