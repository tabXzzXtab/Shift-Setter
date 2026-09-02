#!/usr/bin/env node
/**
 * Two workers accepting the last slot at the same instant.
 *
 * "First accepted wins; the slot closes instantly... Two workers racing for the
 * last slot resolve to exactly one winner, decided randomly, enforced in the
 * database." (Spec Section 4, Tier 3.)
 *
 * The assertion suite cannot test this: it runs in one transaction on one
 * connection, so there is nothing to race. This uses two separately
 * authenticated clients going through PostgREST -- the same path a phone takes
 * -- and fires both accepts from a single Promise.all so they land together.
 *
 * Run several rounds: a lock that is merely usually right will win a single
 * round often enough to look correct.
 */
import { createClient } from "@supabase/supabase-js";
import { required } from "./env.mjs";

const URL = required("NEXT_PUBLIC_SUPABASE_URL");
const ANON = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const ROUNDS = Number(process.env.ROUNDS ?? 8);

const fail = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };
const client = () => createClient(URL, ANON, { auth: { persistSession: false } });

async function signIn(email, password) {
  const sb = client();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) fail(`sign in as ${email}: ${error.message}`);
  return sb;
}

// ---- admin sets the stage ---------------------------------------------------
const admin = await signIn(required("WALKTHROUGH_ADMIN_EMAIL"), required("WALKTHROUGH_ADMIN_PASSWORD"));
const adminId = (await admin.auth.getUser()).data.user.id;

const { data: project } = await admin
  .from("project").select("id, name").is("deleted_at", null).limit(1).single();
if (!project) fail("no project to race on -- run the walkthrough first");

// Two fresh workers, created the only way accounts are ever created.
const stamp = Date.now().toString().slice(-6);
async function createWorker(name) {
  const email = `${name}.${stamp}@bella.test`;
  const password = String(100000 + Math.floor(Math.random() * 900000));
  const { data: { session } } = await admin.auth.getSession();
  const res = await fetch(`${URL}/functions/v1/create-account`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ name: `${name} ${stamp}`, email, password, role: "arbetare" }),
  });
  const body = await res.json();
  if (!res.ok) fail(`create ${name}: ${body.error}`);
  return { ...body, email, password };
}

const a = await createWorker("racer-a");
const b = await createWorker("racer-b");
console.log(`\ntwo workers created; racing ${ROUNDS} rounds on "${project.name}"\n`);

const sbA = await signIn(a.email, a.password);
const sbB = await signIn(b.email, b.password);

// ---- race -------------------------------------------------------------------
let winsA = 0, winsB = 0;
const createdPasses = [];

for (let round = 1; round <= ROUNDS; round++) {
  // A fresh date each round, so both workers are free again.
  const date = new Date(Date.now() + (120 + round) * 864e5).toISOString().slice(0, 10);

  const { data: pass, error: pErr } = await admin
    .from("pass")
    .insert({
      project_id: project.id, work_date: date,
      start_time: "07:00", end_time: "16:00",
      planned_hours: 8, headcount: 1,          // ONE slot. Both want it.
      created_by: adminId,
    })
    .select("id").single();
  if (pErr) fail(`round ${round}: ${pErr.message}`);
  createdPasses.push(pass.id);

  const { error: oErr } = await admin.from("pass_offer").insert([
    { pass_id: pass.id, worker_id: a.worker_id },
    { pass_id: pass.id, worker_id: b.worker_id },
  ]);
  if (oErr) fail(`round ${round} offers: ${oErr.message}`);

  // Both accepts leave at once.
  const [ra, rb] = await Promise.all([
    sbA.rpc("accept_offer", { p_pass: pass.id }),
    sbB.rpc("accept_offer", { p_pass: pass.id }),
  ]);

  const winners = [ra.error ? null : "A", rb.error ? null : "B"].filter(Boolean);

  const { count } = await admin
    .from("tilldelning")
    .select("id", { count: "exact", head: true })
    .eq("pass_id", pass.id)
    .is("released_at", null);

  if (winners.length !== 1) {
    fail(
      `round ${round}: ${winners.length} winners (${winners.join(", ") || "none"}). ` +
      `A: ${ra.error?.message ?? "ok"} | B: ${rb.error?.message ?? "ok"}`,
    );
  }
  if (count !== 1) fail(`round ${round}: pass holds ${count} assignments, headcount is 1`);

  if (winners[0] === "A") winsA++; else winsB++;

  const loser = winners[0] === "A" ? rb.error.message : ra.error.message;
  console.log(`  round ${String(round).padStart(2)}: ${winners[0]} won, other refused -- ${loser.slice(0, 60)}`);
}

// ---- tidy up ----------------------------------------------------------------
for (const id of createdPasses) {
  await admin.rpc("delete_pass", { p_pass: id });
}

console.log(
  `\nEXACTLY ONE WINNER IN ALL ${ROUNDS} ROUNDS, and never more than one ` +
  `assignment on a one-slot pass.\n` +
  `Split A/B: ${winsA}/${winsB} -- decided by whichever request took the row lock first.`,
);
