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
const perturbIn = (signature, find, replace) => async (client) => {
  const { rows } = await client.query(
    `select pg_get_functiondef($1::regprocedure) as def`, [signature],
  );
  // Line endings normalised before matching. A function body carries whatever
  // the migration file had, so a CRLF file made every multi-line control
  // unmatchable -- loudly, but for a reason that has nothing to do with the
  // guard. Postgres does not care which it gets back.
  const def = rows[0].def.replace(/\r\n/g, "\n");
  if (!def.includes(find)) {
    throw new Error(`control text no longer present in ${signature}: ${find.slice(0, 60)}…`);
  }
  return def.replace(find, replace);
};

/** The tier walk lives in app.fill_pass; most generated controls target it. */
const perturb = (find, replace) => perturbIn("app.fill_pass(uuid)", find, replace);

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
   // Two objects, one protection. The CHECK is a tripwire ON the trigger --
   // it exists to catch a confirmed row whose stage the trigger never set --
   // so leaving it armed while the trigger is off makes every confirmation in
   // the suite die on the tripwire instead of reaching the assertion this
   // control is about. Disabling half a protection tests the other half.
   "alter table public.project_day disable trigger confirmation_guard; " +
   "alter table public.project_day drop constraint project_day_stage_matches_confirmation",
   // I4b.wrong_leader still holds without the trigger -- the project_day RLS
   // policy also scopes leaders to their own projects. Defence in depth, so
   // the first assertion that actually depends on the trigger is this one.
   "BRIST.admin_cannot_confirm_as_leader"],

  ["a surveyed day lands at admin_confirmed, not stage 1",
   // The route stays 'bristsurvey' either way, which is the point: if stage
   // could be read off the route this control would be impossible to write.
   perturbIn("app.tg_confirmation_guard()",
             "new.stage := 'admin_confirmed';", "new.stage := 'leader_confirmed';"),
   "BRIST.survey_is_admin_confirmed"],

  ["the survey derives hours from the clock, not the plan",
   // Invariant 1's one exception, removed. A small, distinctive fragment: the
   // "when " prefix is what keeps this off the identical predicate in the
   // overflow check above it. Both branches then fall back to the planned
   // figure, so a worker who clocked a 6.5 hour day is billed 8.
   perturbIn("public.complete_bristsurvey(uuid, date, text)",
             "when t.clock_in is not null and t.clock_out is not null", "when false"),
   "BRIST.survey_hours_from_clock"],

  // ---- STEP 5c, the flagged day -------------------------------------------
  ["invariant 4b's last line -- a flagged day is outside every leader's scope",
   perturbIn("app.tg_confirmation_guard()",
             "if new.flagged_as is not null then", "if false then"),
   "S5C.leader_cannot_confirm_a_flagged_day"],

  ["a flagged day is confirmed as what it actually was",
   // Without it, a day a worker covered can be closed as one nobody was on,
   // and the two admissions stop being different.
   perturbIn("app.tg_confirmation_guard()",
             "if new.flagged_as is distinct from new.confirmed_via then", "if false then"),
   "S5C.wrong_flag_refused"],

  ["letting a day run unsupervised is the admin's alone",
   perturbIn("app.flag_day(uuid, public.confirmation_source, uuid)",
             "if not app.is_admin() then", "if false then"),
   "S5C.leader_cannot_flag_a_day"],

  ["the ansvarig was on the shift",
   perturbIn("public.make_worker_ansvarig(uuid, uuid)",
             "if not exists (", "if false and not exists ("),
   "S5C.ansvarig_must_be_on_the_shift"],

  ["unpausing puts the arbetsledare back",
   // The pause has a trigger and the reactivation had none, so a leader came
   // back only when some worker's assignment next happened to move.
   "drop trigger account_unpause on public.account",
   "PAUSE.unpause_puts_the_leader_back"],

  ["the survey reads an arbetsledare's own span",
   // Dropped, the fallback takes p.planned_hours off whichever pass the
   // leader's row happens to hang on -- somebody else's figure, frozen into a
   // legal document by the one path that exists to get a day right.
   perturbIn("public.complete_bristsurvey(uuid, date, text)",
             "when t.source = 'ledare' and t.own_start is not null", "when false"),
   "BRIST.leader_hours_from_the_envelope"],

  ["the survey is the admin's alone",
   perturbIn("public.bristsurvey_gaps(uuid, date, date)",
             "if not app.is_admin() then", "if false then"),
   "BRIST.gaps_admin_only"],

  ["\"Vad Vi Gjorde\" required before confirming",
   "alter table public.project_day drop constraint vad_vi_gjorde_required_to_confirm",
   "I6.gjorde_required"],

  ["confirmation provenance is mandatory",
   "alter table public.project_day drop constraint confirmed_fields_together",
   // provenance_required is raised by the trigger too; this is the case only
   // the constraint catches.
   "BRIST.confirmed_by_without_confirmation"],

  // ---- STAGE 2 -------------------------------------------------------------
  // Invariant 5 is two walls now, and each is a separate line in a separate
  // guard. A control per wall, so "confirmation is final" cannot quietly come
  // to mean "final at whichever stage still happens to be enforced".
  ["stage 1 is final for the leader",
   perturbIn("app.tg_confirmation_guard()",
             "if not app.is_admin() then   -- stage 2 is the admin's alone", "if false then"),
   // STAGE2.leader_cannot_approve rests on this wall too, but the leader
   // editing his own confirmed day comes first in the suite and is the same
   // rule: stage 1 is final for whoever made it.
   "I5.day_after_confirm"],

  ["admin_confirmed is terminal -- the day record",
   perturbIn("app.tg_confirmation_guard()",
             "if old.stage = 'admin_confirmed' then", "if false then"),
   // The surveyed day is the first admin_confirmed day the suite tries to
   // move, and re-surveying it is the same wall from the other side. Note it
   // only gets through because now() is transaction-start time and constant --
   // the re-survey writes back the identical confirmed_at, so nothing about
   // the claim looks changed and the approve branch accepts it.
   "BRIST.surveyed_day_is_final"],

  ["admin_confirmed is terminal -- the hours",
   perturbIn("app.tg_assignment_write_guard()",
             "if v_stage = 'admin_confirmed' then", "if false then"),
   "STAGE2.hours_final_after_approval"],

  ["admin_confirmed is terminal -- the times",
   // PASS TIDER lives on the pass, not the assignment, so it has its own guard.
   // Without it the wall protects half a row.
   "drop trigger pass_edit_guard on public.pass",
   "STAGE2.times_final_after_approval"],

  ["reviewing a claim is not making one",
   // The admin may approve the leader's confirmation; he may not put his own
   // name on it. Removed, and stage 2 becomes a way to author a stage 1 claim.
   perturbIn("app.tg_confirmation_guard()",
             "if v_claim_moved and new.stage is not null then", "if false then"),
   "STAGE2.claim_stays_the_leaders"],

  ["a rejection carries the admin's note",
   // Three objects, one rule. The trigger refuses a blank note, and two CHECKs
   // stand behind it -- on the day and on the log row it writes. Leaving either
   // armed makes the suite die on the tripwire instead of reaching the
   // assertion this control is about, so the whole rule comes off at once.
   async (client) =>
     (await perturbIn("app.tg_confirmation_guard()",
                      "if new.rejection_note is null or btrim(new.rejection_note) = '' then",
                      "if false then")(client)) +
     "; alter table public.project_day drop constraint project_day_rejection_fields_together" +
     "; alter table public.day_review drop constraint rejection_carries_a_note",
   "STAGE2.reject_needs_note"],

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

  ["invariant 10 -- hours hidden until FILED",
   // The masking removed: hours leak the moment a day is confirmed, before any
   // Arbetsdagbok covers it.
   `create or replace view public.my_shift with (security_invoker = false) as
      select t.id, t.pass_id, p.project_id, pr.name as project_name, pr.site_address,
             p.work_date, p.start_time, p.end_time, p.planned_hours,
             t.clock_in, t.clock_out,
             t.confirmed_hours::numeric,
             (pd.confirmed_at is not null) as day_confirmed,
             exists (select 1 from public.arbetsdagbok a
                     where a.project_id = p.project_id and p.work_date <@ a.covered) as filed
      from public.tilldelning t
      join public.pass p on p.id = t.pass_id and p.deleted_at is null
      join public.project pr on pr.id = p.project_id and pr.deleted_at is null
      left join public.project_day pd
             on pd.project_id = p.project_id and pd.work_date = p.work_date
      where t.released_at is null and t.worker_id = app.current_worker_id()`,
   "I10.hours_hidden_until_filed"],

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
   // A small, distinctive fragment rather than the whole clause: reindenting
   // the function must not silently un-target its own control. Flipping the
   // predicate to false makes the NOT EXISTS always true, so the exclusion
   // stops applying and everyone is offered the day.
   perturb("and not f.can_work", "and false"),
   "TIER3.no_offer_when_cant_work"],

  ["the five-day cutoff on the cascade",
   // Inside five days nothing fires automatically. Move the cutoff to zero and
   // the near case starts cascading, which is exactly what it must not do.
   perturbIn("public.release_assignment(uuid, public.release_reason)",
             "interval '5 days'", "interval '0 days'"),
   "CASCADE.no_autofill_inside_five_days"],

  ["Snabb Pass bypasses the headcount",
   // One line, so the control cannot be broken by reindenting the function.
   // Flipping the condition to false makes the guard apply to Snabb Pass too,
   // and the full pass then refuses the second person.
   perturbIn("app.tg_headcount_guard()", "if new.source = 'snabb' then", "if false then"),
   "SNABB.bypasses_headcount"],

  // ---- AVBOKA PASS, Step 5b -----------------------------------------------
  ["the cards wait until there is nobody to ask",
   // Dropping the "nobody free" half sends Acceptera Pass out over the top of
   // a popup that is about to be answered -- the exact thing Step 5b's
   // ordering exists to prevent.
   perturbIn("public.avboka_pass(uuid)",
             "if v_people = '[]'::jsonb and v_beyond then", "if v_beyond then"),
   // fill_pass walks the förval tiers before it offers anything, so the first
   // thing that breaks is the slot filling itself while the popup is open --
   // the same guard, caught one assertion earlier.
   "AVBOKA.no_autofill_when_someone_free"],

  ["the popup fires inside five days too",
   // Making the popup obey the five-day rule as well collapses manual
   // placement into the automatic path, and a leader standing in front of the
   // day loses the one thing they were there to do.
   perturbIn("public.avboka_pass(uuid)",
             "if v_people = '[]'::jsonb and v_beyond then",
             "if not v_beyond then v_people := '[]'::jsonb; end if; if v_people = '[]'::jsonb and v_beyond then"),
   "AVBOKA.popup_inside_five_days"],

  ["a replacement must not already be working that day",
   // INVARIANT 2 as a question rather than a refusal: without the filter the
   // popup offers someone who is already booked, and picking them raises.
   perturbIn("public.avboka_pass(uuid)",
             "where t2.worker_id = w.id and t2.work_date = v_pass.work_date",
             "where t2.worker_id = w.id and t2.work_date = 'epoch'::date"),
   "AVBOKA.busy_forval_not_offered"],

  ["taking someone off is the project's leader's to do",
   perturbIn("public.avboka_pass(uuid)",
             "if not app.leads_project(v_pass.project_id) then", "if false then"),
   "AVBOKA.other_leader_refused"],

  // ---- STEP 4b, the arbetsledare placed automatically ---------------------

  ["the leader is placed when a worker takes a slot",
   "alter table public.tilldelning disable trigger leader_day",
   "STEP4B.leader_placed"],

  ["the span is the workers' envelope, not one shift's times",
   // Earliest start becomes latest start: the leader arrives when the last
   // person does, which is precisely what the envelope exists to deny.
   perturbIn("app.sync_leader_day(uuid,date)",
             "min(p.start_time), max(p.end_time)",
             "max(p.start_time), max(p.end_time)"),
   "STEP4B.envelope_is_the_workers_span"],

  ["a leader working elsewhere that day is not also placed",
   // The five-space padding is what keeps this off the envelope query's own
   // `and t.source <> 'ledare';` a few lines above it.
   perturbIn("app.sync_leader_day(uuid,date)",
             "and t.source     <> 'ledare'", "and false"),
   "STEP4B.busy_leader_not_placed"],

  ["only a deliberate removal keeps the leader off the day",
   // Any released row becomes a tombstone, so a day that lost its workers and
   // got them back never gets its leader back.
   perturbIn("app.sync_leader_day(uuid,date)",
             "and t.released_reason = 'removed_by_leader'",
             "and t.released_at is not null"),
   "STEP4B.comes_back_when_the_day_does"],

  // ---- BYTA PLATS, two leaders trading a day ------------------------------
  ["a swap is the admin's to make",
   perturbIn("public.swap_partners(uuid)",
             "if not app.is_admin() then", "if false then"),
   "SWAP.leader_cannot_initiate"],

  ["a swap survives the next roster edit",
   // The released rows are the only thing telling sync_leader_day that a
   // person decided this. Release them as anything else and the next worker
   // added to either day puts both original leaders back on top of the swap.
   perturbIn("public.swap_leaders(uuid, uuid)",
             "set released_at = now(), released_reason = 'removed_by_leader',",
             "set released_at = now(), released_reason = 'no_workers_left',"),
   "SWAP.survives_a_roster_edit"],

  // ---- INVARIANT 4b, day-scoped -------------------------------------------
  //
  // Two controls because the rule has two halves and they are held up by two
  // different pieces. Reverting confirms_project() to a membership test breaks
  // BOTH assertions, so the refusal is asserted first in the suite and this
  // control lands on it; the permission is left to a control that touches only
  // the trigger's gate, where the refusal still holds.
  ["a leader who was not on the day cannot confirm it",
   // Straight back to the old rule: membership, whoever actually stood there.
   perturbIn("app.confirms_project(uuid, date)",
             "then app.holds_the_day(p_project, p_work_date)",
             "then exists (select 1 from public.project_leader pl2 " +
             "where pl2.project_id = p_project and pl2.account_id = (select auth.uid()))"),
   "SWAP.swapped_out_cannot_confirm"],

  ["a leader who WAS on the day can reach it",
   // The gate before the stage 1 test. Without the day clause it admits only
   // members, so the swapped-in leader is turned away one step early -- while
   // the swapped-out leader, who is a member, still reaches confirms_project()
   // and is still correctly refused there.
   perturbIn("app.tg_confirmation_guard()",
             "if not (app.leads_project(new.project_id) or app.holds_the_day(new.project_id, new.work_date)) then",
             "if not app.leads_project(new.project_id) then"),
   "SWAP.swapped_in_can_confirm"],

  // ---- PAUSE, both halves of it -------------------------------------------
  ["a paused account gives up what it has not started",
   // The whole trigger. Without it a paused person keeps every future shift
   // and the schedule shows somebody who can no longer sign in.
   "drop trigger account_pause on public.account",
   "PAUSE.releases_future"],

  ["a pause takes the future, never the shift already running",
   // The time filter alone. Everything else about the pause still works, so
   // releases_future passes and this lands on the one assertion the filter
   // holds up. Perturbed to the DAY rather than removed outright: releasing
   // every past shift makes the pause collide with invariant 5 on a day that
   // is already admin_confirmed, and the suite would die on that instead of
   // on the assertion. This releases today and nothing earlier, which is
   // exactly the mistake the filter prevents.
   perturbIn("app.tg_account_pause()",
             "      and app.pass_start_at(p.work_date, p.start_time) > now()\n" +
             "    order by p.work_date",
             "      and p.work_date >= app.stockholm_today()\n    order by p.work_date"),
   "PAUSE.keeps_started_shift"],

  // ---- the two holes found reading Step 5c against the spec ---------------

  ["a replacement leader comes back when the day does",
   // The memory of who was standing there, removed. The member insert above it
   // still runs, so the day is not left empty by accident -- it is left to
   // whoever is a MEMBER, which after route 1 is nobody, and the replacement
   // never returns.
   perturbIn("app.sync_leader_day(uuid,date)",
             "and r.released_reason = 'no_workers_left'", "and false"),
   "S5C.replacement_returns_when_the_day_does"],

  ["a worker is made ansvarig only when no arbetsledare is free",
   // The candidate set emptied, so the guard can never find anybody and the
   // fallback becomes an alternative -- which is the whole difference between
   // covering a gap and choosing to run a day without a supervisor.
   perturbIn("public.make_worker_ansvarig(uuid,uuid)",
             "where a.role = 'arbetsledare'", "where false"),
   "S5C.ansvarig_needs_no_leader_free"],

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
