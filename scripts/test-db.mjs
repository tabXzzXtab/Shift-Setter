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
  ["stage 2 -- a leader's times go to the leader's row",
   // The routing forced down the OLD path: every corrected span written to the
   // pass. The leader's own_start then never moves, which is the gap this
   // change closed -- an admin could not correct a leader's span at all
   // without moving every worker on the shift to do it.
   perturbIn("public.approve_day(uuid,date,text,jsonb)",
             "if coalesce(v_ledare, false) then", "if false then"),
   "LEDARE.stage2_writes_the_leaders_own_span"],

  // THERE IS NO MIRROR CONTROL FOR "a worker's times still go to the pass",
  // and that is a better answer than a control. Forcing the routing the other
  // way does not silently misfile a worker's span: the check constraint
  // tilldelning_own_span_is_the_leaders refuses the row outright, so the
  // perturbed run dies on the constraint instead of reaching an assertion.
  // The guarantee is stronger than the test would have been, and
  // LEDARE.a_workers_row_has_no_own_span is what states it.

  ["stage 2 -- only a leader's row may carry its own span",
   "alter table public.tilldelning drop constraint tilldelning_own_span_is_the_leaders",
   "LEDARE.a_workers_row_has_no_own_span"],

  ["personlig kalender -- an event is private to its owner and whoever they named",
   // The read policy made permissive. Everything else about the feature still
   // works, which is the point: a calendar that showed everybody everything
   // would look entirely correct to whoever wrote it.
   "drop policy personal_event_select on public.personal_event; " +
   "create policy personal_event_select on public.personal_event for select using (true)",
   "PERSONAL.unnamed_cannot_see"],

  ["personlig kalender -- nobody writes an event in another person's name",
   // ONLY THE WITH CHECK IS PERTURBED. The USING clause is left owner-scoped
   // on purpose: personal_event_write is FOR ALL, so its USING also serves
   // SELECT, and removing it would land on PERSONAL.unnamed_cannot_see -- the
   // control above -- rather than on anything about writing. What is left is
   // the half a USING clause cannot hold up, which is the half that decides
   // whose name a new row may carry.
   "drop policy personal_event_write on public.personal_event; " +
   "create policy personal_event_write on public.personal_event for all " +
   "using (owner_id = (select auth.uid())) with check (true)",
   "PERSONAL.cannot_create_in_another_name"],

  ["push token -- a handset belongs to whoever signed in last",
   // The primary key moved off the token and onto (account_id, token), which
   // is the shape that looks perfectly reasonable in review: every account
   // keeps its own registration for the device it uses. On a shared site
   // phone it means two live rows for one handset, and the person holding it
   // receives the other one's shifts.
   //
   // THE FUNCTION MOVES WITH IT. Perturbing the key alone makes the upsert die
   // on its own ON CONFLICT clause, which fails the run somewhere that says
   // nothing about who owns a handset. The composite world has to be
   // internally consistent or the control is testing a typo.
   "alter table public.push_token drop constraint push_token_pkey; " +
   "alter table public.push_token add primary key (account_id, token); " +
   "create or replace function public.register_push_token(p_token text, p_platform text) " +
   "returns void language plpgsql security definer set search_path = '' as $ctl$ " +
   "declare v_account uuid := (select auth.uid()); begin " +
   "if v_account is null then raise exception 'not signed in' using errcode = 'insufficient_privilege'; end if; " +
   "insert into public.push_token (token, account_id, platform, updated_at) " +
   "values (btrim(p_token), v_account, p_platform, now()) " +
   "on conflict (account_id, token) do update set platform = excluded.platform, updated_at = now(); " +
   "end $ctl$",
   "PUSH.one_row_per_device"],

  ["push token -- signing out elsewhere cannot silence a handset that moved on",
   // The delete widened to the token alone. Still deletes the right row in the
   // ordinary case, which is why it needs a control: it only misbehaves once a
   // device has changed hands.
   "create or replace function public.forget_push_token(p_token text) " +
   "returns void language sql security definer set search_path = '' as " +
   "$$ delete from public.push_token where token = btrim(p_token) $$",
   "PUSH.forget_is_scoped_to_the_caller"],

  ["push token -- device tokens are not readable from a browser",
   // A select policy that looks like every other one in the schema. Nothing
   // else about the feature changes; what changes is that a logged-in user can
   // enumerate the addresses of other people's phones.
   "create policy push_token_select on public.push_token for select to authenticated using (true); " +
   "grant select on public.push_token to authenticated",
   "PUSH.no_direct_read"],

  ["invariant 2 -- no two assignments whose hours overlap",
   // The index this used to drop is gone: invariant 2 is a no-overlap rule
   // now, and a trigger is what holds it up.
   "drop trigger no_overlapping_assignment on public.tilldelning",
   "I2.two_projects_same_day"],

  ["invariant 2 -- back to back is not an overlap",
   // Half-open made closed. A shift starting exactly where another ends would
   // then count as a clash, which is the case the whole rule exists to allow.
   // Only the second comparison is perturbed; the first would break the
   // refusals above instead and the control would land on the wrong one.
   perturbIn("app.tg_no_overlapping_assignment()",
             "and v_start < app.pass_end_at(p.work_date, p.start_time, p.end_time)",
             "and v_start <= app.pass_end_at(p.work_date, p.start_time, p.end_time)"),
   "I2.back_to_back_is_allowed"],

  // ---- Snabb Pass replaces what it collides with, and nothing else --------
  ["a Snabb Pass leaves a shift it does not overlap",
   // The time predicate removed from the release: back to clearing the day.
   perturbIn("public.create_snabb_pass(uuid,uuid,date,time,time,numeric,boolean,text,jsonb)",
             "and app.pass_start_at(p.work_date, p.start_time) < app.pass_end_at(p_date, p_start, p_end)\n" +
             "    and app.pass_start_at(p_date, p_start) < app.pass_end_at(p.work_date, p.start_time, p.end_time);",
             ";"),
   "SNABB.keeps_what_it_does_not_touch"],

  ["a Snabb Pass never takes the arbetsledare off the day",
   // The source filter removed from the release. The ledare row is not a slot
   // and nothing about a Snabb Pass on a worker concerns it.
   perturbIn("public.create_snabb_pass(uuid,uuid,date,time,time,numeric,boolean,text,jsonb)",
             "and t.source     <> 'ledare'          -- never takes a leader off their day",
             "and true"),
   "SNABB.never_takes_the_leader_off"],

  ["a locked day is refused in the admin's own language",
   // The friendly check removed, so invariant 5 raises instead and the admin
   // gets the database's wording -- which is exactly what was reported.
   perturbIn("public.create_snabb_pass(uuid,uuid,date,time,time,numeric,boolean,text,jsonb)",
             "if v_stuck is not null then", "if false then"),
   "SNABB.locked_day_refused_plainly"],

  // ---- Snabb Pass filing its own day, and the four things it refuses ------
  //
  // EVERY ONE OF THESE IS GUARDED TWICE -- once by the RPC in Swedish, once by
  // app.tg_confirmation_guard() or a CHECK in English -- so removing either
  // layer still leaves the call refused. A control asserting only "it was
  // refused" would pass with the guard gone and prove nothing. That is why
  // each suite assertion tests the SWEDISH SENTENCE: with the RPC's check
  // removed the deeper layer answers instead, in the database's own words,
  // and the assertion fails at exactly the right place.
  ["Före is refused on a day somebody else is already on",
   perturbIn("public.create_snabb_pass(uuid,uuid,date,time,time,numeric,boolean,text,jsonb)",
             "if v_other > 0 then", "if false then"),
   "SNABB.fore_refuses_a_shared_day"],

  ["Före is refused on a day that has not happened",
   perturbIn("public.create_snabb_pass(uuid,uuid,date,time,time,numeric,boolean,text,jsonb)",
             "if p_date > app.stockholm_today() then", "if false then"),
   "SNABB.fore_refuses_the_future"],

  ["Före is refused with no account of the day",
   perturbIn("public.create_snabb_pass(uuid,uuid,date,time,time,numeric,boolean,text,jsonb)",
             "if p_text is null or btrim(p_text) = '' then", "if false then"),
   "SNABB.fore_needs_the_day_account"],

  ["Före is refused while an arbetsledare row has no accepted figure",
   perturbIn("public.create_snabb_pass(uuid,uuid,date,time,time,numeric,boolean,text,jsonb)",
             "if v_missing is not null then", "if false then"),
   "SNABB.fore_needs_every_leader_figure"],

  // INVARIANT 1. The accepted figure replaced by the worker's own hours -- the
  // exact failure this route has to be incapable of, because Före closes the
  // day and nobody can correct it afterwards. The fixture accepts 6.25 against
  // a 07:00-15:00 span precisely so that neither the worker's 7.50 nor any
  // derived number can satisfy the assertion by coincidence.
  ["the arbetsledare's accepted hours are what gets filed",
   perturbIn("public.create_snabb_pass(uuid,uuid,date,time,time,numeric,boolean,text,jsonb)",
             "set confirmed_hours = (r->>'hours')::numeric",
             "set confirmed_hours = p_hours"),
   "SNABB.fore_takes_the_leaders_accepted_hours"],

  ["the snabb route reaches admin_confirmed at all",
   perturbIn("app.tg_confirmation_guard()",
             "elsif new.confirmed_via = 'snabb' then", "elsif false then"),
   "SNABB.fore_files_the_day"],

  ["Efter bekräftelse tells the arbetsledare",
   perturbIn("public.create_snabb_pass(uuid,uuid,date,time,time,numeric,boolean,text,jsonb)",
             "'snabb_review',", "'day_flagged',"),
   "SNABB.efter_tells_the_leader"],

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

  ["a shift already under way cannot be erased",
   // Only the start-time check. The other assertion about a started shift sits
   // on a pass somebody had clocked in on, so it survives this and the control
   // lands on the fixture nobody touched -- which is why that fixture exists.
   perturbIn("app.tg_pass_delete_guard()",
             "if now() >= app.pass_start_at(old.work_date, old.start_time) then",
             "if false then"),
   "DEL.started_shift_with_nobody_clocked_in"],

  ["a cancelled day is cancelled only when nothing survives",
   // The NOT EXISTS dropped: one shift called off makes the whole day read as
   // called off, with people still working it.
   `create or replace view public.cancelled_day with (security_invoker = false) as ` +
   `select p.project_id, p.work_date, pr.name as project_name, ` +
   `count(*)::integer as cancelled_passes, max(p.deleted_at) as cancelled_at ` +
   `from public.pass p ` +
   `join public.project pr on pr.id = p.project_id and pr.deleted_at is null ` +
   `where p.deleted_at is not null and app.leads_project(p.project_id) ` +
   `group by p.project_id, p.work_date, pr.name`,
   "DEL.a_live_shift_keeps_the_day"],

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

  ["Handplocka is for arbetare",
   // Hand-picking fills the slots a pass demanded, and an arbetsledare never
   // occupies one. Off, and a leader can be picked onto a worker slot -- which
   // is how Step 4b then skips them and the day loses the person answerable
   // for it. The list in Skapa Pass is decorative; this is the boundary.
   "alter table public.pass_batch_handpick disable trigger handpick_is_an_arbetare",
   "HANDPICK.leader_refused"],

  ["and an arbetare can still be hand-picked",
   // The other direction of the same guard, and the reason it needs its own
   // control: switching the trigger OFF cannot fail HANDPICK.arbetare_accepted,
   // so nothing above holds up the ordinary case. Refuse everyone instead and
   // Handplocka becomes a list that names people it will not accept -- which
   // the refusal control would happily report as a pass.
   //
   // The `if` and the `then` are load-bearing: `<> 'arbetare'` appears in the
   // comment above the test, and a find that matched prose would rewrite the
   // comment and prove nothing.
   perturbIn("app.tg_handpick_is_an_arbetare()",
             "if v_role is distinct from 'arbetare' then", "if true then"),
   "HANDPICK.arbetare_can_be_picked"],

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

  // ---- the late mark the confirmation writes -------------------------------
  // One line, perturbed both ways: it has to let the confirmation through AND
  // keep everyone out of their own late marks, and breaking either direction
  // has to be caught by a different assertion.

  ["the confirmation's own late mark gets through",
   // The `if ` matters: the same expression appears in the comment above the
   // test, and a bare find would rewrite that instead and prove nothing.
   perturbIn("app.tg_worker_self_edit_guard()", "if pg_trigger_depth() > 1", "if false"),
   "LATE.leader_confirms_a_late_day"],

  ["and nobody reaches their own late marks by hand",
   // The depth test is the only thing separating the confirmation's write from
   // a person's. Without it a tidy +1 on your own row looks identical.
   perturbIn("app.tg_worker_self_edit_guard()", "if pg_trigger_depth() > 1", "if true"),
   "LATE.self_edit_still_refused"],

  // ---- redigera och ta bort projekt ---------------------------------------
  // Four controls, because the feature rests on four separate things: two
  // rules inside the function, and both halves of the policy.

  ["a project with somebody on a future day cannot be deleted",
   // The refusal short-circuited. Past work still would not block -- that is
   // the assertion below this one, and it must keep passing.
   perturbIn("public.delete_project(uuid)", "if exists (", "if false and exists ("),
   "PROJEKT.active_passes_block"],

  ["deleting a project is an admin act",
   // Without the gate the leader of the project deletes it, which is exactly
   // the confusion app.leads_project() would have introduced here.
   perturbIn("public.delete_project(uuid)", "if not app.is_admin() then", "if false then"),
   "PROJEKT.admin_only"],

  ["invariant 8 -- a deleted project leaves the admin's reads",
   // USING widened back to what it was before this migration. WITH CHECK is
   // left strict, so the direct-update assertion still passes and this control
   // can only land on the read.
   "drop policy if exists project_admin_write on public.project; " +
   "create policy project_admin_write on public.project for all to authenticated " +
   "using (app.is_admin()) with check (app.is_admin() and deleted_at is null)",
   "PROJEKT.invisible_after_delete"],

  ["deleted_at is never set by a client UPDATE",
   // The policy exactly as it stood BEFORE this migration, both halves widened.
   //
   // Widening one half proves nothing, and this control failed until it was
   // measured: on an ALL policy the USING expression is applied to the row an
   // UPDATE produces as well as to the row it reads, so USING alone refuses
   // the write and WITH CHECK alone refuses it too. Either half is sufficient
   // and neither is necessary, which makes the pair the guard and the whole
   // pre-migration policy the only honest thing to remove.
   //
   // Hand-checked against the live database, all four ways round: shipped,
   // USING-widened and CHECK-widened all raise; both-widened sets deleted_at.
   "drop policy if exists project_admin_write on public.project; " +
   "create policy project_admin_write on public.project for all to authenticated " +
   "using (app.is_admin()) with check (app.is_admin())",
   "PROJEKT.no_direct_soft_delete"],

  // ---- arbetsledaren skapar projekt ---------------------------------------
  // Ten controls, because the feature is ten separate things: two policies
  // added, one widened, one written a particular way, two triggers and the
  // three clauses of a view. Removing any one of them has to land somewhere
  // different from the other nine.

  ["an arbetsledare creates a project at all",
   // The insert policy dropped. project_admin_write is untouched, so the admin
   // keeps creating and the suite lands on the leader's insert and nowhere
   // else -- which is the whole of what this migration handed over.
   "drop policy if exists project_staff_insert on public.project",
   "LEDPROJ.leader_creates"],

  ["a project is not created in somebody else's name",
   // The forced authorship made a passthrough, so the id the client sent
   // stands. created_by decides who may name a project's leaders, so a column
   // the caller controls is a claim on somebody else's project.
   perturbIn("app.tg_project_created_by()",
             "new.created_by := (select auth.uid());",
             "new.created_by := new.created_by;"),
   "LEDPROJ.created_by_is_forced"],

  ["a leader reads back the project they just made",
   // The select policy exactly as it stood before this migration. Between the
   // client's two statements there is no project_leader row yet, so without
   // the created_project clause the row is invisible to its own author: the
   // RETURNING comes back empty and the form reports failure over a project
   // that exists.
   "drop policy if exists project_staff_select on public.project; " +
   "create policy project_staff_select on public.project for select " +
   "using (deleted_at is null and (app.leads_project(id) or app.holds_a_day(id)))",
   "LEDPROJ.creator_reads_it_back"],

  ["the read-back clause tests the row, not the table",
   // The same policy written with app.created_project(id) -- which is what it
   // looked like first, and it passes every assertion but one. The helper is
   // STABLE, so it sees the snapshot the command started with and cannot see
   // the row that command is inserting: ordinary SELECTs are fine and the
   // RETURNING clause the client actually sends raises "new row violates
   // row-level security policy". This control is the difference between the
   // two forms, and nothing else distinguishes them.
   "drop policy if exists project_staff_select on public.project; " +
   "create policy project_staff_select on public.project for select " +
   "using (deleted_at is null and (app.leads_project(id) or app.holds_a_day(id) " +
   "or app.created_project(id)))",
   "LEDPROJ.insert_returns_the_row"],

  ["naming a project's leaders is scoped to the project you made",
   // The scope removed, leaving "any member of staff may add anybody to
   // anything" -- which is what keying this on leads_project() would have come
   // to as well.
   "drop policy if exists project_leader_creator_insert on public.project_leader; " +
   "create policy project_leader_creator_insert on public.project_leader " +
   "for insert to authenticated with check (app.is_staff())",
   "LEDPROJ.not_on_someone_elses_project"],

  ["only an arbetsledare can be made responsible for a project",
   // The role trigger dropped. It lands on the arbetare first, which is the
   // invariant 4 half; the admin half is the assertion directly after it and
   // rests on the same object.
   "drop trigger project_leader_is_a_leader on public.project_leader",
   "LEDPROJ.arbetare_cannot_be_responsible"],

  ["creating a project is not editing it",
   // The UPDATE the split withheld, handed back as a policy of its own rather
   // than by widening project_staff_insert to FOR ALL: a FOR ALL policy's
   // USING would widen what a leader can READ as well, and the control would
   // land on a visibility assertion instead of on the edit.
   "create policy project_staff_update on public.project for update to authenticated " +
   "using (app.is_staff() and deleted_at is null) " +
   "with check (app.is_staff() and deleted_at is null)",
   "LEDPROJ.creator_cannot_edit"],

  // The three clauses of the picker's list. It is a view and not a policy, so
  // each clause is removed on its own -- the same reason worker_roster carries
  // its guard in a WHERE rather than in a grant.

  ["the picker's list is staff only",
   "create or replace view public.arbetsledare_roster with (security_invoker = false) as " +
   "select a.id, coalesce(w.name, u.raw_user_meta_data->>'name') as name " +
   "from public.account a " +
   "left join public.worker w on w.account_id = a.id and w.deleted_at is null " +
   "left join auth.users u on u.id = a.id " +
   "where a.role = 'arbetsledare' and a.active",
   "LEDPROJ.roster_is_staff_only"],

  ["the picker's list holds arbetsledare and nobody else",
   "create or replace view public.arbetsledare_roster with (security_invoker = false) as " +
   "select a.id, coalesce(w.name, u.raw_user_meta_data->>'name') as name " +
   "from public.account a " +
   "left join public.worker w on w.account_id = a.id and w.deleted_at is null " +
   "left join auth.users u on u.id = a.id " +
   "where a.active and app.is_staff()",
   "LEDPROJ.roster_is_leaders_only"],

  ["the picker's list skips a paused leader",
   "create or replace view public.arbetsledare_roster with (security_invoker = false) as " +
   "select a.id, coalesce(w.name, u.raw_user_meta_data->>'name') as name " +
   "from public.account a " +
   "left join public.worker w on w.account_id = a.id and w.deleted_at is null " +
   "left join auth.users u on u.id = a.id " +
   "where a.role = 'arbetsledare' and app.is_staff()",
   "LEDPROJ.roster_skips_paused"],

  // ---- Stäng Pågående Pass ------------------------------------------------
  ["ending a running pass is the admin's alone",
   perturbIn("public.close_pass(uuid,numeric)",
             "if not app.is_admin() then", "if false then"),
   "CLOSE.leader_cannot_close"],

  ["closing keeps the hours of whoever turned up",
   // The clock_in split removed from the release, so everyone comes off the
   // pass -- and the Arbetsdagbok reads released_at is null, so the hours the
   // first one actually worked would print nowhere. This is the whole reason
   // closing is not "delete, but for active passes".
   perturbIn("public.close_pass(uuid,numeric)",
             "    and t.clock_in is null;", "    and true;"),
   "CLOSE.clocked_in_keeps_the_hours"],

  ["closing never invents a clock-out",
   // Invariant 3. Stamping one at closure would read as the worker having
   // stamped out themselves, in the one place the system treats as evidence.
   perturbIn("public.close_pass(uuid,numeric)",
             "  set confirmed_hours = p_hours",
             "  set confirmed_hours = p_hours, clock_out = v_now"),
   "CLOSE.no_clock_out_is_invented"],

  // NO CONTROL FOR CLOSE.does_not_confirm_the_day, and not for want of trying.
  // The assertion guards an ABSENCE: close_pass simply contains no confirmation,
  // so there is no guard to disable -- the same shape as the flag-freeze and
  // the swap project filter, both dropped earlier for the same reason.
  //
  // The attempt was still worth making. Perturbing close_pass to write the day
  // to admin_confirmed does not produce a wrong value, it produces a REFUSAL:
  // "day X is not over yet; its last shift ends ...". Invariant 5 stops a
  // fourth route to admin_confirmed from existing at all while the pass it
  // closes is still running, which is a stronger answer than the control would
  // have been. The assertion stays as a tripwire for the day somebody adds one.

  ["invariant 7 -- project creation is a gate",
   `alter table public.project drop constraint ` +
   `"${"project_bestallare_orgnr_check"}"`,
   "I7.blank_orgnr_rejected"],

  // ---- ALLA KONTON ---------------------------------------------------------

  ["alla konton -- a removed account leaves the admin's sight",
   // The view put back the way it was before the migration. Removal still
   // works in every other respect; the admin simply goes on seeing the people
   // they removed, which is the whole of what the filter is for.
   "create or replace view public.account_directory with (security_invoker = false) as " +
   "select a.id, a.role, a.active, w.id as worker_id, " +
   "coalesce(w.name, u.raw_user_meta_data->>'name') as name, " +
   "coalesce(w.email, u.email::text) as email, p.avatar_path " +
   "from public.account a " +
   "left join public.worker w on w.account_id = a.id and w.deleted_at is null " +
   "left join auth.users u on u.id = a.id " +
   "left join public.profile p on p.account_id = a.id " +
   "where app.is_admin() or a.id = (select auth.uid())",
   "KONTO.removed_leaves_the_directory"],

  ["alla konton -- history is what makes an account unerasable",
   // The RESTRICT dropped. delete_account can no longer tell the two cases
   // apart and erases somebody who has stood on a shift -- taking the name off
   // hours an Arbetsdagbok already reports. Invariant 3. The function asks the
   // constraint precisely so that it cannot be wrong about this, and this is
   // the control that proves it is the constraint being asked.
   "alter table public.tilldelning drop constraint tilldelning_worker_id_fkey",
   "KONTO.history_is_shut_down"],

  ["alla konton -- a shut-down account's worker is soft-deleted",
   // INVARIANT 8. Without it the account is inactive but the worker row is
   // still live, so every roster and every sum goes on counting them.
   perturbIn("public.delete_account(uuid)",
             "    update public.worker\n" +
             "       set deleted_at = now()\n" +
             "     where account_id = p_account and deleted_at is null;",
             "    null;"),
   "KONTO.history_worker_soft_deleted"],

  ["alla konton -- only an admin removes an account",
   perturbIn("public.delete_account(uuid)",
             "if not app.is_admin() then", "if false then"),
   "KONTO.arbetare_cannot_remove"],

  ["alla konton -- nobody removes their own account",
   perturbIn("public.delete_account(uuid)",
             "if p_account = (select auth.uid()) then", "if false then"),
   "KONTO.cannot_remove_self"],

  ["alla konton -- a face belongs to one account",
   // The path test dropped from the write policy, so anyone may write into
   // anyone's folder -- including over somebody else's face.
   "drop policy avatars_write on storage.objects; " +
   "create policy avatars_write on storage.objects for insert to authenticated " +
   "with check (bucket_id = 'avatars')",
   "KONTO.avatar_foreign_upload_rejected"],

  ["alla konton -- a face is not public",
   // The read policy made permissive. Every screen still looks right; a
   // colleague's photograph is simply readable by every logged-in person.
   "drop policy avatars_read on storage.objects; " +
   "create policy avatars_read on storage.objects for select to authenticated " +
   "using (bucket_id = 'avatars')",
   "KONTO.avatar_is_not_public"],
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
