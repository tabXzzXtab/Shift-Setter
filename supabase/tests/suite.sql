-- ============================================================================
-- Assertion suite -- runs against the real database.
--
-- No transaction control here: scripts/test-db.mjs wraps the whole file in a
-- transaction and rolls it back, and runs it once per negative control with a
-- guard disabled to prove each assertion actually depends on that guard.
--
-- Every failure raises 'ASSERT_FAIL:<name>: <detail>' so the runner can check
-- WHICH assertion fired, not merely that something did. A negative control
-- that fails at the wrong assertion is not a passing negative control.
-- ============================================================================

create or replace function pg_temp.ok(cond boolean, name text, detail text default '')
returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'ASSERT_FAIL:%: %', name, detail;
  end if;
end $$;

-- Asserts a statement is REJECTED. Re-raises our own failures so a guard that
-- silently allows the write cannot be mistaken for one that rejected it.
create or replace function pg_temp.rejects(stmt text, name text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm like 'ASSERT_FAIL:%' then raise; end if;
    -- Rejected for the wrong reason. A policy that cannot execute its own
    -- helper is a broken policy, and would otherwise read as a guard doing
    -- its job. This is how the missing grant on schema app was found.
    if sqlerrm like 'permission denied for function%'
       or sqlerrm like 'permission denied for schema%' then
      raise exception 'ASSERT_FAIL:%: rejected for the WRONG reason: %', name, sqlerrm;
    end if;
    return;
  end;
  raise exception 'ASSERT_FAIL:%: statement was accepted but must be rejected', name;
end $$;

create or replace function pg_temp.act_as(p_account uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_account)::text, true);
end $$;

-- ============================================================================
-- FIXTURES
-- ============================================================================

create temporary table fx (k text primary key, v uuid);
insert into fx (k, v) values
  ('admin',    '11111111-1111-1111-1111-111111111111'),
  ('admin2',   '11111111-1111-1111-1111-111111111112'),
  ('leaderA',  '22222222-2222-2222-2222-22222222222a'),
  ('leaderB',  '22222222-2222-2222-2222-22222222222b'),
  ('w1',       '33333333-3333-3333-3333-333333333331'),
  ('w2',       '33333333-3333-3333-3333-333333333332'),
  ('w3',       '33333333-3333-3333-3333-333333333333'),
  ('ghost',    '44444444-4444-4444-4444-444444444444');

-- Readable after SET ROLE: a temp table belongs to the session user, and the
-- RLS tests below run as authenticated and anon.
grant select on fx to public;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated',
       k || '@suite.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from fx;

insert into public.account (id, role, active)
select v, case
             when k like 'admin%' then 'admin'::public.app_role
             when k like 'leader%' then 'arbetsledare'::public.app_role
             else 'arbetare'::public.app_role
           end,
       k <> 'admin2'
from fx where k <> 'ghost';
-- admin2 starts paused, so the suite's 'admin' is the last active admin
-- WITHIN the suite. Real admin accounts exist in this database now, so they
-- are paused for the duration of this transaction -- which is always rolled
-- back -- or invariant 11 could not be tested at all.
--
-- Order matters: the suite's admin is inserted first, so pausing the real ones
-- is legal. The guard only ever refuses the last active admin.
update public.account set active = false
where role = 'admin'
  and id not in (select v from fx where k like 'admin%');

insert into public.worker (account_id, name, email)
select v, initcap(k), k || '@suite.test' from fx where k in ('w1','w2','w3','leaderA');
-- leaderA has a worker record: an arbetsledare is also a worker (Section 2).

insert into public.project (id, name, site_address, bestallare_address,
                            bestallare_bolag, bestallare_orgnr, services, start_date)
values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Projekt A', 'Sitegatan 1',
   'Kundgatan 2', 'Kund AB', '556788-2369', 'Bygg', current_date - 30),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'Projekt B', 'Sitegatan 3',
   'Kundgatan 4', 'Annan AB', '556788-0000', 'Service', current_date - 30);

insert into public.project_leader (project_id, account_id)
-- Explicit casts: UNION resolves two unknown literals to text, and the column
-- is uuid.
select 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid, v from fx where k = 'leaderA'
union all
select 'bbbbbbbb-0000-0000-0000-00000000000b'::uuid, v from fx where k = 'leaderB';

-- PASS1: project A, yesterday, two slots. Ended, so it is confirmable.
-- PASS2: project B, the same day -- for invariant 2.
-- PASS3: project A, ten days out -- for the delete rules.
-- PASS4: project A, a night shift -- for invariant 9.
insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select p.a, p.b, p.c, p.d, p.e, p.f, p.g, (select f.v from fx f where f.k = 'leaderA')
from (values
  ('cccccccc-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
   app.stockholm_today() - 1, '07:00'::time, '16:00'::time, 8.00::numeric, 2::smallint),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-00000000000b',
   app.stockholm_today() - 1, '07:00', '16:00', 8.00, 1),
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a',
   app.stockholm_today() + 10, '07:00', '16:00', 8.00, 1),
  ('cccccccc-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-00000000000a',
   app.stockholm_today() - 3, '22:00', '06:00', 7.50, 1)
) as p(a, b, c, d, e, f, g);

-- ============================================================================
-- INVARIANT 9 -- Stockholm-anchored dates
-- ============================================================================

select pg_temp.ok(
  app.stockholm_today() = (now() at time zone 'Europe/Stockholm')::date,
  'I9.today', 'stockholm_today must not use the server default (UTC)');

-- A night shift ending 06:00 ends the NEXT morning, not eighteen hours earlier.
select pg_temp.ok(
  app.pass_end_at(date '2026-03-10', '22:00', '06:00')
    = app.pass_start_at(date '2026-03-11', '06:00'),
  'I9.nightshift', 'a shift ending at or before its start crosses midnight');

select pg_temp.ok(
  app.pass_end_at(date '2026-03-10', '07:00', '16:00')
    > app.pass_start_at(date '2026-03-10', '07:00'),
  'I9.dayshift', 'an ordinary shift ends the same day');

-- ============================================================================
-- INVARIANT 1 -- hours are typed by a human, nothing derives them
-- ============================================================================

select pg_temp.ok(
  (select count(*) from pg_attribute a
   join pg_class c on c.oid = a.attrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and a.attgenerated <> '' ) = 0,
  'I1.no_generated', 'no column in public may be GENERATED -- hours must not derive from the span');

-- ============================================================================
-- INVARIANT 2 -- no worker holds two assignments on the same date
-- ============================================================================

insert into public.tilldelning (id, pass_id, worker_id, source, work_date)
select 'dddddddd-0000-0000-0000-000000000001',
       'cccccccc-0000-0000-0000-000000000001',
       w.id, 'forval', app.stockholm_today() - 1
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w1';

select pg_temp.rejects($$
  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  select 'cccccccc-0000-0000-0000-000000000002', w.id, 'forval', app.stockholm_today() - 1
  from public.worker w join fx on fx.v = w.account_id where fx.k = 'w1'
$$, 'I2.two_projects_same_day');

-- A released assignment frees the day -- this is what lets a Snabb Pass win.
update public.tilldelning set released_at = now(), released_reason = 'removed_by_leader'
where id = 'dddddddd-0000-0000-0000-000000000001';

insert into public.tilldelning (pass_id, worker_id, source, work_date)
select 'cccccccc-0000-0000-0000-000000000002', w.id, 'snabb', app.stockholm_today() - 1
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w1';

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   join public.worker w on w.id = t.worker_id
   join fx on fx.v = w.account_id
   where fx.k = 'w1' and t.released_at is null and t.work_date = app.stockholm_today() - 1) = 1,
  'I2.release_frees_day', 'exactly one live assignment on the day after a release');

-- ============================================================================
-- HEADCOUNT -- Tier 3, exactly one winner for the last slot
-- ============================================================================

insert into public.tilldelning (id, pass_id, worker_id, source, work_date)
select 'dddddddd-0000-0000-0000-000000000002',
       'cccccccc-0000-0000-0000-000000000001', w.id, 'forval', app.stockholm_today() - 1
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w2';

insert into public.tilldelning (pass_id, worker_id, source, work_date)
select 'cccccccc-0000-0000-0000-000000000001', w.id, 'forval', app.stockholm_today() - 1
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w3';

-- PASS1 has headcount 2 and now holds 2. A third must not fit.
select pg_temp.rejects($$
  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  select 'cccccccc-0000-0000-0000-000000000001', w.id, 'manuell', app.stockholm_today() - 1
  from public.worker w join fx on fx.v = w.account_id where fx.k = 'leaderA'
$$, 'HEADCOUNT.overfill');

-- ============================================================================
-- INVARIANT 3 -- clock stamps are append-only evidence
-- ============================================================================

-- Driven through the real paths: the worker clocks themselves in via the RPC,
-- the leader corrects it as an authenticated leader. Doing this as the
-- database owner would leave edited_by null, which the schema rightly refuses.
set local role authenticated;

select pg_temp.act_as((select v from fx where k = 'w2'));
select public.clock_in('dddddddd-0000-0000-0000-000000000002');

-- The stamp is the server's, never the phone's. RLS FILTERS this row rather
-- than raising -- an UPDATE matching no visible row is a silent no-op, not an
-- error -- so the assertion is on state, not on an exception.
update public.tilldelning set clock_in = now() - interval '3 hours'
where id = 'dddddddd-0000-0000-0000-000000000002';

reset role;

select pg_temp.ok(
  (select clock_in > now() - interval '2 minutes'
   from public.tilldelning where id = 'dddddddd-0000-0000-0000-000000000002'),
  'I3.worker_cannot_move_stamp', 'the worker''s attempt to backdate the stamp changed nothing');

-- my_shift deliberately does not expose the originals, so this reads the table.
select pg_temp.ok(
  (select clock_in is not null and clock_in_original = clock_in
   from public.tilldelning where id = 'dddddddd-0000-0000-0000-000000000002'),
  'I3.original_captured', 'the first clock value is captured as the original');

-- The leader may overwrite the working value.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));

update public.tilldelning set clock_in = app.pass_start_at(app.stockholm_today() - 1, '07:00')
where id = 'dddddddd-0000-0000-0000-000000000002';

-- A genuinely different value. now() is transaction-start time and is constant
-- for the whole transaction, so assigning now() here would be assigning the
-- value the trigger already stored -- a no-op with nothing to reject.
select pg_temp.rejects($$
  update public.tilldelning set clock_in_original = now() - interval '5 hours'
  where id = 'dddddddd-0000-0000-0000-000000000002'
$$, 'I3.original_immutable');

reset role;

select pg_temp.ok(
  (select clock_in_original is distinct from clock_in
   from public.tilldelning where id = 'dddddddd-0000-0000-0000-000000000002'),
  'I3.original_survives_edit', 'the original survives underneath the leader''s value');

select pg_temp.ok(
  (select count(*) from public.clock_edit ce
   join fx on fx.v = ce.edited_by
   where ce.tilldelning_id = 'dddddddd-0000-0000-0000-000000000002'
     and fx.k = 'leaderA' and ce.field = 'clock_in') = 1,
  'I3.edit_attributed', 'the edit is appended and attributed to whoever made it');

-- ============================================================================
-- INVARIANT 4b + BRISTSURVEY -- who may confirm, and by which route
-- ============================================================================

-- Hours first: confirming may not leave anyone's hours unset.
update public.tilldelning set confirmed_hours = 8.00
where pass_id = 'cccccccc-0000-0000-0000-000000000001' and released_at is null;

set local role authenticated;

-- LeaderB does not run project A.
select pg_temp.act_as((select v from fx where k = 'leaderB'));
select pg_temp.rejects($$
  insert into public.project_day (project_id, work_date, vad_vi_gjorde, confirmed_at, confirmed_by, confirmed_via)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() - 1,
          'Grävde', now(), (select v from fx where k='leaderB'), 'leader')
$$, 'I4b.wrong_leader');

-- The admin may NOT confirm as a leader. This is the pressure the system runs on.
select pg_temp.act_as((select v from fx where k = 'admin'));
select pg_temp.rejects($$
  insert into public.project_day (project_id, work_date, vad_vi_gjorde, confirmed_at, confirmed_by, confirmed_via)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() - 1,
          'Grävde', now(), (select v from fx where k='admin'), 'leader')
$$, 'BRIST.admin_cannot_confirm_as_leader');

-- A leader may not launder a confirmation as a survey either.
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.rejects($$
  insert into public.project_day (project_id, work_date, vad_vi_gjorde, confirmed_at, confirmed_by, confirmed_via)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() - 1,
          'Grävde', now(), (select v from fx where k='leaderA'), 'bristsurvey')
$$, 'BRIST.leader_cannot_survey');

-- A confirmed day must say how it was confirmed.
select pg_temp.rejects($$
  insert into public.project_day (project_id, work_date, vad_vi_gjorde, confirmed_at, confirmed_by)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() - 1,
          'Grävde', now(), (select v from fx where k='leaderA'))
$$, 'BRIST.provenance_required');

-- confirmed_by without confirmed_at is a half-written confirmation. The
-- trigger does not look at this case; only the CHECK constraint does, which is
-- what makes it a negative control for the constraint alone.
select pg_temp.rejects($$
  insert into public.project_day (project_id, work_date, vad_vi_gjorde, confirmed_by)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() - 2,
          'Halvfärdig', (select v from fx where k='leaderA'))
$$, 'BRIST.confirmed_by_without_confirmation');

-- The "Vad Vi Gjorde" text is mandatory before the confirm.
select pg_temp.rejects($$
  insert into public.project_day (project_id, work_date, confirmed_at, confirmed_by, confirmed_via)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() - 1,
          now(), (select v from fx where k='leaderA'), 'leader')
$$, 'I6.gjorde_required');

-- A day is not confirmable before its last shift has ended.
select pg_temp.rejects($$
  insert into public.project_day (project_id, work_date, vad_vi_gjorde, confirmed_at, confirmed_by, confirmed_via)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() + 10,
          'Framtid', now(), (select v from fx where k='leaderA'), 'leader')
$$, 'CONFIRM.not_over_yet');

-- The assigned leader confirms. This one must succeed.
insert into public.project_day (project_id, work_date, vad_vi_gjorde, confirmed_at, confirmed_by, confirmed_via)
values ('aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() - 1,
        'Grävde grund och göt platta', now(),
        (select v from fx where k='leaderA'), 'leader');

reset role;

select pg_temp.ok(
  (select confirmed_via = 'leader' and confirmed_by = (select v from fx where k='leaderA')
   from public.project_day
   where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and work_date = app.stockholm_today() - 1),
  'BRIST.provenance_recorded', 'a leader-confirmed day records who and by which route');

-- ============================================================================
-- INVARIANT 5 -- confirmation is final
-- ============================================================================

select pg_temp.rejects($$
  update public.tilldelning set confirmed_hours = 4.00
  where pass_id = 'cccccccc-0000-0000-0000-000000000001' and released_at is null
$$, 'I5.hours_after_confirm');

select pg_temp.rejects($$
  update public.project_day set vad_vi_gjorde = 'ändrat'
  where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
    and work_date = app.stockholm_today() - 1
$$, 'I5.day_after_confirm');

select pg_temp.rejects($$
  delete from public.project_day
  where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
    and work_date = app.stockholm_today() - 1
$$, 'I5.delete_confirmed_day');

-- ============================================================================
-- INVARIANT 11 -- the last active admin
-- ============================================================================

select pg_temp.rejects($$
  update public.account set role = 'arbetare' where id = (select v from fx where k='admin')
$$, 'I11.demote_last_admin');

select pg_temp.rejects($$
  update public.account set active = false where id = (select v from fx where k='admin')
$$, 'I11.pause_last_admin');

select pg_temp.rejects($$
  delete from public.account where id = (select v from fx where k='admin')
$$, 'I11.delete_last_admin');

-- With a second active admin, the first may go.
update public.account set active = true where id = (select v from fx where k='admin2');
update public.account set role = 'arbetare' where id = (select v from fx where k='admin');
select pg_temp.ok(
  (select role = 'arbetare' from public.account where id = (select v from fx where k='admin')),
  'I11.demote_when_not_last', 'demotion is allowed once another active admin exists');
update public.account set role = 'admin' where id = (select v from fx where k='admin');

-- ============================================================================
-- INVARIANT 6 -- the document cannot generate with any cell empty
-- ============================================================================

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));

-- The night shift on today-3 is unconfirmed, so a range covering it is blocked.
-- generated_by is supplied explicitly. The guard overwrites it with auth.uid()
-- anyway, but leaving it out would make this fail on a NOT NULL violation when
-- the guard is disabled -- which is not the assertion under test.
select pg_temp.rejects($$
  insert into public.arbetsdagbok (project_id, covered, generated_by)
  values ('aaaaaaaa-0000-0000-0000-00000000000a',
          daterange(app.stockholm_today() - 5, app.stockholm_today(), '[)'),
          (select v from fx where k = 'admin'))
$$, 'I6.unconfirmed_day_blocks');

-- A range containing only the confirmed day generates.
insert into public.arbetsdagbok (project_id, covered, generated_by)
values ('aaaaaaaa-0000-0000-0000-00000000000a',
        daterange(app.stockholm_today() - 1, app.stockholm_today(), '[)'),
        (select v from fx where k = 'admin'));

select pg_temp.ok(
  (select count(*) from public.arbetsdagbok
   where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 1,
  'I6.generates_when_complete', 'a fully confirmed range generates');

reset role;

-- Overlap is detectable -- a warning, not a block.
select pg_temp.ok(
  (select count(*) from public.arbetsdagbok
   where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and covered && daterange(app.stockholm_today() - 1, app.stockholm_today(), '[)')) = 1,
  'DOC.overlap_detectable', 'an overlapping range can be found before generating');

-- ============================================================================
-- INVARIANT 10 -- confirmed hours are the only hours shown to a worker
-- INVARIANT 8 -- deleted projects count nowhere
-- ============================================================================

-- w3 holds an unconfirmed assignment on the night shift, with hours already
-- typed by the leader but the day not yet confirmed.
insert into public.tilldelning (pass_id, worker_id, source, work_date, confirmed_hours)
select 'cccccccc-0000-0000-0000-000000000004', w.id, 'forval', app.stockholm_today() - 3, 7.50
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w3';

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'w3'));

select pg_temp.ok(
  (select confirmed_hours is null from public.my_shift
   where work_date = app.stockholm_today() - 3),
  'I10.hours_hidden_until_confirmed',
  'a worker must not see hours that can still change');

select pg_temp.ok(
  (select confirmed_hours = 8.00 from public.my_shift
   where work_date = app.stockholm_today() - 1),
  'I10.hours_shown_when_confirmed', 'confirmed hours are visible');

-- A worker cannot reach the assignment table directly.
select pg_temp.ok(
  (select count(*) from public.tilldelning) = 0,
  'RLS.worker_cannot_read_tilldelning', 'a worker reads my_shift, never the table');

-- Nor a colleague's personal data.
select pg_temp.ok(
  (select count(*) from public.worker) = 1,
  'RLS.worker_sees_only_self', 'a worker must never see a colleague''s personal data');

reset role;

-- Soft-delete project A: its shifts must count nowhere.
update public.project set deleted_at = now()
where id = 'aaaaaaaa-0000-0000-0000-00000000000a';

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'w2'));
select pg_temp.ok(
  (select count(*) from public.my_shift) = 0,
  'I8.deleted_project_counts_nowhere', 'a deleted project vanishes from every read');
reset role;

update public.project set deleted_at = null
where id = 'aaaaaaaa-0000-0000-0000-00000000000a';

-- ============================================================================
-- ANON -- the login gate is a courtesy; the database is the boundary
-- ============================================================================

set local role anon;
select pg_temp.rejects($$ select count(*) from public.project $$, 'ANON.no_project_read');
select pg_temp.rejects($$ select count(*) from public.worker $$,  'ANON.no_worker_read');
reset role;

-- ============================================================================
-- INVARIANT 7 -- project creation is a gate, not a form
-- ============================================================================

select pg_temp.rejects($$
  insert into public.project (name, site_address, bestallare_address,
                              bestallare_bolag, bestallare_orgnr, services, start_date)
  values ('Utan orgnr', 'A', 'B', 'C', '   ', 'D', current_date)
$$, 'I7.blank_orgnr_rejected');

-- ============================================================================
-- SHIFT DELETION -- Section 2b
-- ============================================================================

set local role authenticated;

-- A leader is not an admin here.
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.rejects($$
  select public.delete_pass('cccccccc-0000-0000-0000-000000000003')
$$, 'DEL.leader_cannot_delete');

-- An ongoing / past shift is a fact to be confirmed, not erased.
select pg_temp.act_as((select v from fx where k = 'admin'));
select pg_temp.rejects($$
  select public.delete_pass('cccccccc-0000-0000-0000-000000000001')
$$, 'DEL.started_shift_cannot_be_deleted');

-- A future shift can go, and the people on it are told and blocked from re-offer.
insert into public.tilldelning (pass_id, worker_id, source, work_date)
select 'cccccccc-0000-0000-0000-000000000003', w.id, 'forval', app.stockholm_today() + 10
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w1';

select public.delete_pass('cccccccc-0000-0000-0000-000000000003');
reset role;

select pg_temp.ok(
  (select count(*) from public.notification n
   join fx on fx.v = n.account_id
   where fx.k = 'w1' and n.kind = 'shift_deleted') = 1,
  'DEL.worker_notified', 'a worker is told when a shift they hold is deleted');

select pg_temp.ok(
  (select count(*) from public.pass_block where pass_id = 'cccccccc-0000-0000-0000-000000000003') = 1,
  'DEL.blocked_from_reoffer', 'a deleted shift is never re-offered to the people removed from it');

select pg_temp.rejects($$
  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  select 'cccccccc-0000-0000-0000-000000000003', w.id, 'forval', app.stockholm_today() + 10
  from public.worker w join fx on fx.v = w.account_id where fx.k = 'w1'
$$, 'DEL.no_reoffer_enforced');

-- Snabb Pass is the deliberate way back.
insert into public.tilldelning (pass_id, worker_id, source, work_date)
select 'cccccccc-0000-0000-0000-000000000003', w.id, 'snabb', app.stockholm_today() + 10
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w1';

-- ============================================================================
-- FÖRVAL AND THE PRIORITY TIERS -- Step 3 and Step 4
--
-- All on future dates, so nothing here collides with the confirmation rules
-- exercised above.
-- ============================================================================

-- D1 carries two passes: one that already holds w3, and the batch's own.
insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select 'eeeeeeee-0000-0000-0000-000000000001'::uuid,
       'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
       app.stockholm_today() + 20, '07:00'::time, '16:00'::time, 8.00, 1::smallint,
       (select v from fx where k = 'leaderA');

insert into public.tilldelning (pass_id, worker_id, source, work_date)
select 'eeeeeeee-0000-0000-0000-000000000001', w.id, 'manuell', app.stockholm_today() + 20
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w3';

insert into public.pass_batch (id, project_id, created_by)
select 'ffffffff-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-00000000000a',
       (select v from fx where k = 'leaderA');

-- w1 and w3 are hand-picked. w3 already works that date, so being hand-picked
-- must not save them: "not rankable, not offered, not a fallback".
insert into public.pass_batch_handpick (batch_id, worker_id)
select 'ffffffff-0000-0000-0000-00000000000b', w.id
from public.worker w join fx on fx.v = w.account_id where fx.k in ('w1', 'w3');

-- w1, w2, w3 pre-pick the day. leaderA (also a worker) does not.
insert into public.forval (worker_id, work_date, can_work)
select w.id, app.stockholm_today() + 20, true
from public.worker w join fx on fx.v = w.account_id where fx.k in ('w1', 'w2', 'w3');

insert into public.pass (id, project_id, batch_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select 'eeeeeeee-0000-0000-0000-000000000002'::uuid,
       'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
       'ffffffff-0000-0000-0000-00000000000b'::uuid,
       app.stockholm_today() + 20, '07:00'::time, '16:00'::time, 8.00, 2::smallint,
       (select v from fx where k = 'leaderA');

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select public.fill_passes('ffffffff-0000-0000-0000-00000000000b');
reset role;

select pg_temp.ok(
  (select t.source = 'handplockad' from public.tilldelning t
   join public.worker w on w.id = t.worker_id join fx on fx.v = w.account_id
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000002' and fx.k = 'w1'),
  'TIER.tier1_handpicked_with_forval',
  'hand-picked AND pre-picked takes the first slot, marked handplockad');

select pg_temp.ok(
  (select t.source = 'forval' from public.tilldelning t
   join public.worker w on w.id = t.worker_id join fx on fx.v = w.account_id
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000002' and fx.k = 'w2'),
  'TIER.tier2_other_forvalda',
  'everyone else who pre-picked fills the rest, marked forval');

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   join public.worker w on w.id = t.worker_id join fx on fx.v = w.account_id
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000002' and fx.k = 'w3') = 0,
  'TIER.exclusion_beats_handpick',
  'already working that date makes a worker invisible, hand-picked or not');

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   join public.worker w on w.id = t.worker_id join fx on fx.v = w.account_id
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000002' and fx.k = 'leaderA') = 0,
  'TIER.no_forval_no_slot',
  'the forval is the entry ticket; not marking the day means not on the list');

-- ---- ordering: a lateness mark pushes a worker down ------------------------
--
-- Built so that the lateness offset is the ONLY thing deciding the outcome,
-- and decides it deterministically:
--
--   w2 already holds a shift on the Monday of that week, so on shifts-that-week
--   alone w1 (none) ranks FIRST and would take the slot.
--   w1 carries three lateness marks, which push them to position four.
--
-- So with the rule, w2 wins; without it, w1 does. A control that removes the
-- offset therefore flips this assertion rather than leaving it to a coin toss,
-- which is what a two-candidate tie would have been.

-- Monday of a week far from everything else in this suite.
insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select 'eeeeeeee-0000-0000-0000-00000000000a'::uuid,
       'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
       app.week_start(app.stockholm_today() + 40), '07:00'::time, '16:00'::time,
       8.00, 1::smallint, (select v from fx where k = 'leaderA');

insert into public.tilldelning (pass_id, worker_id, source, work_date)
select 'eeeeeeee-0000-0000-0000-00000000000a', w.id, 'manuell',
       app.week_start(app.stockholm_today() + 40)
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w2';

-- late_marks is not the worker's to move, and postgres carries no admin claim,
-- so worker_self_edit_guard refuses it. Set it as the admin would.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));
update public.worker set late_marks = 3
where id = (select w.id from public.worker w join fx on fx.v = w.account_id where fx.k = 'w1');
reset role;

-- Thursday of the same week.
insert into public.forval (worker_id, work_date, can_work)
select w.id, app.week_start(app.stockholm_today() + 40) + 3, true
from public.worker w join fx on fx.v = w.account_id where fx.k in ('w1', 'w2');

insert into public.pass_batch (id, project_id, created_by)
select 'ffffffff-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-00000000000a',
       (select v from fx where k = 'leaderA');

insert into public.pass (id, project_id, batch_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select 'eeeeeeee-0000-0000-0000-000000000003'::uuid,
       'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
       'ffffffff-0000-0000-0000-00000000000c'::uuid,
       app.week_start(app.stockholm_today() + 40) + 3, '07:00'::time, '16:00'::time,
       8.00, 1::smallint, (select v from fx where k = 'leaderA');

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select public.fill_passes('ffffffff-0000-0000-0000-00000000000c');
reset role;

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   join public.worker w on w.id = t.worker_id join fx on fx.v = w.account_id
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000003' and fx.k = 'w2') = 1,
  'TIER.lateness_demotes',
  'three lateness marks cost w1 a slot they would otherwise have won on shift count');

-- ---- Tier 3: Acceptera Pass ------------------------------------------------
-- Nobody pre-picks D3 except w1, who marks it cant-work.
insert into public.forval (worker_id, work_date, can_work)
select w.id, app.stockholm_today() + 22, false
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w1';

insert into public.pass_batch (id, project_id, created_by)
select 'ffffffff-0000-0000-0000-00000000000d', 'aaaaaaaa-0000-0000-0000-00000000000a',
       (select v from fx where k = 'leaderA');

insert into public.pass (id, project_id, batch_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select 'eeeeeeee-0000-0000-0000-000000000004'::uuid,
       'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
       'ffffffff-0000-0000-0000-00000000000d'::uuid,
       app.stockholm_today() + 22, '07:00'::time, '16:00'::time, 8.00, 1::smallint,
       (select v from fx where k = 'leaderA');

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select public.fill_passes('ffffffff-0000-0000-0000-00000000000d');
reset role;

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000004' and t.released_at is null) = 0,
  'TIER3.nothing_assigned_without_forval',
  'an empty forval list assigns nobody -- it goes to Acceptera Pass instead');

select pg_temp.ok(
  (select count(*) from public.pass_offer o
   join public.worker w on w.id = o.worker_id join fx on fx.v = w.account_id
   where o.pass_id = 'eeeeeeee-0000-0000-0000-000000000004' and fx.k = 'w2') = 1,
  'TIER3.offered_when_forval_exhausted',
  'everyone free that day gets the card');

select pg_temp.ok(
  (select count(*) from public.pass_offer o
   join public.worker w on w.id = o.worker_id join fx on fx.v = w.account_id
   where o.pass_id = 'eeeeeeee-0000-0000-0000-000000000004' and fx.k = 'w1') = 0,
  'TIER3.no_offer_when_cant_work',
  'marking a day cant-work is an answer; it is not asked again');

-- Accepting takes the slot, and it enters as an ordinary assignment.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'w2'));
select public.accept_offer('eeeeeeee-0000-0000-0000-000000000004');
reset role;

select pg_temp.ok(
  (select t.source = 'oppen' from public.tilldelning t
   join public.worker w on w.id = t.worker_id join fx on fx.v = w.account_id
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000004' and fx.k = 'w2'),
  'TIER3.accept_assigns', 'accepting the card assigns the worker, marked oppen');

-- The pass is full, so it leaves everyone else's queue.
select pg_temp.ok(
  (select count(*) from public.pass_offer o
   where o.pass_id = 'eeeeeeee-0000-0000-0000-000000000004' and o.state = 'offered') = 0,
  'TIER3.queue_closes_when_full',
  'once headcount is met the pass vanishes from every other queue');

select pg_temp.ok(true, 'SUITE.complete', 'every assertion passed');
