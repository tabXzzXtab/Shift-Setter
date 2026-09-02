#!/usr/bin/env node
/**
 * Run the assertion suite against the real database, then run it again once
 * per negative control with that guard disabled.
 *
 * From CLAUDE.md: "Every test suite ships with negative controls: disable the
 * protection, confirm the suite fails at the expected assertion. A suite that
 * would pass with the guard removed proves nothing."
 *
 * A negative control passes only when the suite fails at the SPECIFIC
 * assertion that guard is supposed to hold up. Failing somewhere else means
 * the assertion was resting on something other than the guard, and is a red.
 *
 * Everything runs inside a transaction that is always rolled back, so the
 * database is untouched -- including the disabled triggers.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { connectionString } from "./env.mjs";

const SUITE = readFileSync("supabase/tests/suite.sql", "utf8");

/**
 * Some protections are rules INSIDE a function rather than a droppable object.
 * Those controls are generated from the live definition and one documented
 * substitution, so a control can never drift from the function it is testing --
 * if the text is gone, the control fails loudly instead of quietly passing.
 */
const perturb = (find, replace) => async (client) => {
  const { rows } = await client.query(
    `select pg_get_functiondef('public.fill_passes(uuid)'::regprocedure) as def`,
  );
  const def = rows[0].def;
  if (!def.includes(find)) {
    throw new Error(`control text no longer present in fill_passes: ${find.slice(0, 60)}…`);
  }
  return def.replace(find, replace);
};

/** Each control: disable one protection, name the assertion that must then fail. */
const CONTROLS = [
  ["invariant 2 -- one assignment per worker per day",
   "drop index public.tilldelning_one_per_worker_per_day",
   "I2.two_projects_same_day"],

  ["headcount -- exactly one winner for the last slot",
   "alter table public.tilldelning disable trigger headcount_guard",
   "HEADCOUNT.overfill"],

  ["invariant 3 -- clock stamps are append-only",
   "alter table public.tilldelning disable trigger clock_evidence",
   "I3.original_captured"],

  ["invariants 4/4b/5 on assignments",
   "alter table public.tilldelning disable trigger assignment_write_guard",
   "I5.hours_after_confirm"],

  ["confirmation scope and provenance",
   "alter table public.project_day disable trigger confirmation_guard",
   // I4b.wrong_leader still holds without the trigger -- the project_day RLS
   // policy also scopes leaders to their own projects. Defence in depth, so
   // the first assertion that actually depends on the trigger is this one.
   "BRIST.admin_cannot_confirm_as_leader"],

  ["\"Vad Vi Gjorde\" required before confirming",
   "alter table public.project_day drop constraint vad_vi_gjorde_required_to_confirm",
   "I6.gjorde_required"],

  ["confirmation provenance is mandatory",
   "alter table public.project_day drop constraint confirmed_fields_together",
   // provenance_required is raised by the trigger too; this is the case only
   // the constraint catches.
   "BRIST.confirmed_by_without_confirmation"],

  ["invariant 11 -- the last active admin",
   "alter table public.account disable trigger last_admin_guard",
   "I11.demote_last_admin"],

  ["invariant 6 -- the document cannot generate with gaps",
   "alter table public.arbetsdagbok disable trigger arbetsdagbok_guard",
   "I6.unconfirmed_day_blocks"],

  ["shift deletion rules",
   "alter table public.pass disable trigger pass_delete_guard",
   "DEL.leader_cannot_delete"],

  ["a deleted shift is never re-offered",
   "alter table public.tilldelning disable trigger block_guard",
   "DEL.no_reoffer_enforced"],

  ["invariant 10 -- hours hidden until confirmed",
   `create or replace view public.my_shift with (security_invoker = false) as
      select t.id, t.pass_id, p.project_id, pr.name as project_name, pr.site_address,
             p.work_date, p.start_time, p.end_time, p.planned_hours,
             t.clock_in, t.clock_out,
             t.confirmed_hours::numeric,
             (pd.confirmed_at is not null) as day_confirmed
      from public.tilldelning t
      join public.pass p on p.id = t.pass_id and p.deleted_at is null
      join public.project pr on pr.id = p.project_id and pr.deleted_at is null
      left join public.project_day pd
             on pd.project_id = p.project_id and pd.work_date = p.work_date
      where t.released_at is null and t.worker_id = app.current_worker_id()`,
   "I10.hours_hidden_until_confirmed"],

  ["a worker must never see a colleague's personal data",
   "alter table public.worker disable row level security",
   "RLS.worker_sees_only_self"],

  ["the exclusion filter, before any tier",
   perturb("and f.worker_id not in (select worker_id from excluded)", "and true"),
   // Without it, w3 is hand-picked AND already working that date, so they sort
   // into the second slot ahead of w2 -- and their insert then dies on
   // invariant 2's index, leaving the slot unfilled. w2 never gets it.
   "TIER.tier2_other_forvalda"],

  ["lateness pushes a worker down the list",
   perturb("+ late_marks as rank_in_tier", "+ 0 as rank_in_tier"),
   "TIER.lateness_demotes"],

  ["cant-work is not asked again",
   perturb(
     `and not exists (
          select 1 from public.forval f
          where f.worker_id = w.id and f.work_date = r.wd and not f.can_work
        )`,
     "and true"),
   "TIER3.no_offer_when_cant_work"],

  ["invariant 7 -- project creation is a gate",
   `alter table public.project drop constraint ` +
   `"${"project_bestallare_orgnr_check"}"`,
   "I7.blank_orgnr_rejected"],
];

const client = new pg.Client({
  connectionString: connectionString(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  statement_timeout: 120000,
});

/** Runs the suite in a transaction, always rolls back. Returns the failure, or null. */
async function runSuite(disableSql) {
  await client.query("begin");
  try {
    if (disableSql) {
      const sql = typeof disableSql === "function" ? await disableSql(client) : disableSql;
      await client.query(sql);
    }
    await client.query(SUITE);
    return null;
  } catch (e) {
    const m = /ASSERT_FAIL:([^:]+):/.exec(e.message);
    return { assertion: m ? m[1] : null, message: e.message.split("\n")[0] };
  } finally {
    await client.query("rollback");
  }
}

await client.connect();
let reds = 0;

console.log("=".repeat(74));
console.log("BASELINE -- every guard in place, the suite must pass");
console.log("=".repeat(74));

const baseline = await runSuite(null);
if (baseline) {
  console.log(`  FAIL at ${baseline.assertion ?? "(not an assertion)"}`);
  console.log(`        ${baseline.message}`);
  reds++;
} else {
  console.log("  PASS -- all assertions held");
}

if (!baseline) {
  console.log("\n" + "=".repeat(74));
  console.log("NEGATIVE CONTROLS -- remove one guard, the named assertion must fail");
  console.log("=".repeat(74));

  for (const [label, disable, expected] of CONTROLS) {
    const r = await runSuite(disable);
    if (!r) {
      console.log(`  RED    ${label}`);
      console.log(`         suite PASSED with the guard removed -- it proves nothing`);
      reds++;
    } else if (r.assertion !== expected) {
      console.log(`  RED    ${label}`);
      console.log(`         expected ${expected}, got ${r.assertion ?? "(not an assertion): " + r.message}`);
      reds++;
    } else {
      console.log(`  ok     ${label}`);
      console.log(`         -> failed at ${expected}, as it must`);
    }
  }
}

await client.end();

console.log("\n" + "=".repeat(74));
console.log(reds === 0
  ? `ALL GREEN -- baseline passes and all ${CONTROLS.length} negative controls fail where they should`
  : `${reds} RED`);
console.log("The database is unchanged: every run was rolled back.");
process.exit(reds === 0 ? 0 : 1);
