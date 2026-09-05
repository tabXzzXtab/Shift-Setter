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

-- Fixture worker ids, resolved while still the owner. A leader cannot SELECT
-- the worker table at all -- names come from worker_roster, which carries no
-- email -- so looking one up mid-call returns NULL and reads as "no such
-- worker".
create temporary table wid as
select fx.k, w.id from public.worker w join fx on fx.v = w.account_id;
grant select on wid to public;

-- The suite runs against the REAL database, so real workers and whatever they
-- have marked on their calendars are visible to the priority list. A day a
-- real person marked would put them in the ranking and decide these assertions
-- instead of the fixtures -- which is exactly what happened once someone
-- started using the demo. Cleared inside this transaction, which is always
-- rolled back, so the tiers are decided by the fixtures alone.
delete from public.forval f where f.worker_id not in (select id from wid);

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
  'I10.hours_hidden_until_filed',
  'a worker must not see hours that can still change');

-- This day is inside the range the document generated above covers.
select pg_temp.ok(
  (select confirmed_hours = 8.00 and filed from public.my_shift
   where work_date = app.stockholm_today() - 1),
  'I10.hours_shown_once_filed', 'hours appear once an Arbetsdagbok covers the day');

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
-- THE BRISTSURVEY -- the admin closes a day no leader ever confirmed
--
-- Two branches of the one derivation, on one day, so the assertions can tell
-- them apart: w1 clocked both ends (6.5 h, and the pass was planned at 8, so a
-- wrong source is visible), w2 clocked neither (falls back to the planned 8).
-- w3's night shift already carries hours a leader typed, and the survey must
-- not touch them.
-- ============================================================================

insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
values ('cccccccc-0000-0000-0000-000000000005',
        'aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() - 2,
        '07:00', '16:00', 8.00, 2,
        (select v from fx where k = 'leaderA'));

insert into public.tilldelning (id, pass_id, worker_id, source, work_date)
select 'dddddddd-0000-0000-0000-000000000005',
       'cccccccc-0000-0000-0000-000000000005', w.id, 'forval', app.stockholm_today() - 2
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w1';

insert into public.tilldelning (pass_id, worker_id, source, work_date)
select 'cccccccc-0000-0000-0000-000000000005', w.id, 'forval', app.stockholm_today() - 2
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w2';

set local role authenticated;

-- The stamps are set as the leader, not as the owner: to anyone who is not
-- staff the evidence trigger replaces a supplied stamp with now(), which is
-- exactly right and which silently made this fixture a zero-hour span the
-- first time. The story is a leader who corrected the stamps on site and then
-- never got round to confirming the day -- which is how days end up here.
select pg_temp.act_as((select v from fx where k = 'leaderA'));
update public.tilldelning
set clock_in  = app.pass_start_at(app.stockholm_today() - 2, '08:00'),
    clock_out = app.pass_start_at(app.stockholm_today() - 2, '14:30')
where id = 'dddddddd-0000-0000-0000-000000000005';

select pg_temp.ok(
  (select clock_out - clock_in = interval '6 hours 30 minutes'
   from public.tilldelning where id = 'dddddddd-0000-0000-0000-000000000005'),
  'BRIST.fixture_span_is_real',
  'the fixture really does hold a 6.5 hour span, not a stamp the trigger replaced');

-- A leader may not see the survey. It reads every worker's stamps across a
-- whole project and names who owes the confirmations; that is the admin's view.
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.rejects($$
  select public.bristsurvey_gaps('aaaaaaaa-0000-0000-0000-00000000000a',
                                 app.stockholm_today() - 5, app.stockholm_today() - 1)
$$, 'BRIST.gaps_admin_only');

-- Nor complete one. The admin cannot confirm as a leader; the leader cannot
-- confirm as the admin either.
select pg_temp.rejects($$
  select public.complete_bristsurvey('aaaaaaaa-0000-0000-0000-00000000000a',
                                     app.stockholm_today() - 2, 'Lade tak')
$$, 'BRIST.leader_cannot_complete');

select pg_temp.act_as((select v from fx where k = 'admin'));

-- What is in the way: today-2 and today-3, and not today-1, which is confirmed.
select pg_temp.ok(
  (select jsonb_array_length(g->'days') = 2
      and (g->'days'->0->>'work_date')::date = app.stockholm_today() - 3
      and (g->'days'->1->>'work_date')::date = app.stockholm_today() - 2
   from public.bristsurvey_gaps('aaaaaaaa-0000-0000-0000-00000000000a',
                                app.stockholm_today() - 5, app.stockholm_today() - 1) g),
  'BRIST.gaps_lists_unconfirmed',
  'the survey names exactly the days in the way, and leaves the confirmed one out');

-- Chasing the leader is the right outcome, so the screen has to be able to
-- name them.
select pg_temp.ok(
  (select g->'leaders' ? (select w.name from public.worker w
                          where w.account_id = (select v from fx where k = 'leaderA'))
   from public.bristsurvey_gaps('aaaaaaaa-0000-0000-0000-00000000000a',
                                app.stockholm_today() - 5, app.stockholm_today() - 1) g),
  'BRIST.gaps_names_the_leader', 'the survey names whoever owed the confirmation');

-- The figures come from what was registered, and the survey shows them before
-- anything is written. 6.5 from the clock, 8 from the plan -- on the same day.
select pg_temp.ok(
  (select d->'rows' @> '[{"timmar": 6.50, "tider": "08:00-14:30", "stamplat": true}]'::jsonb
      and d->'rows' @> '[{"timmar": 8.00, "tider": "07:00-16:00", "stamplat": false}]'::jsonb
   from public.bristsurvey_gaps('aaaaaaaa-0000-0000-0000-00000000000a',
                                app.stockholm_today() - 5, app.stockholm_today() - 1) g,
        lateral jsonb_array_elements(g->'days') d
   where (d->>'work_date')::date = app.stockholm_today() - 2),
  'BRIST.gaps_prefills_registered',
  'the clock span where both ends exist, the planned figure where they do not');

-- The account of the day is the whole of what is typed, and it is mandatory.
select pg_temp.rejects($$
  select public.complete_bristsurvey('aaaaaaaa-0000-0000-0000-00000000000a',
                                     app.stockholm_today() - 2, '   ')
$$, 'BRIST.text_required');

select public.complete_bristsurvey('aaaaaaaa-0000-0000-0000-00000000000a',
                                   app.stockholm_today() - 2,
                                   'Reste ställning på gaveln och bar in material.');
select public.complete_bristsurvey('aaaaaaaa-0000-0000-0000-00000000000a',
                                   app.stockholm_today() - 3,
                                   'Nattarbete: rev och forslade bort gammalt tegel.');

reset role;

-- THE EXCEPTION TO INVARIANT 1, and the only one. Nobody typed these.
select pg_temp.ok(
  (select t.confirmed_hours = 6.50
   from public.tilldelning t
   where t.pass_id = 'cccccccc-0000-0000-0000-000000000005'
     and t.worker_id = (select id from wid where k = 'w1')),
  'BRIST.survey_hours_from_clock',
  'a worker who clocked both ends gets the clock span, not the planned figure');

select pg_temp.ok(
  (select t.confirmed_hours = 8.00
   from public.tilldelning t
   where t.pass_id = 'cccccccc-0000-0000-0000-000000000005'
     and t.worker_id = (select id from wid where k = 'w2')),
  'BRIST.survey_hours_from_planned',
  'a worker who clocked neither end gets the planned figure');


-- Hours a human already typed are that human's. The survey fills gaps; it does
-- not restate what was already stated.
select pg_temp.ok(
  (select t.confirmed_hours = 7.50
   from public.tilldelning t
   where t.pass_id = 'cccccccc-0000-0000-0000-000000000004' and t.released_at is null
     and t.source <> 'ledare'),
  'BRIST.survey_leaves_typed_hours_alone',
  'a figure a leader typed survives the survey untouched');

-- Where a surveyed day lands: admin_confirmed, by the bristsurvey route, in
-- the admin's name. Route and stage are separate axes and both are recorded.
select pg_temp.ok(
  (select stage = 'admin_confirmed' and confirmed_via = 'bristsurvey'
      and confirmed_by = (select v from fx where k = 'admin')
   from public.project_day
   where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and work_date = app.stockholm_today() - 2),
  'BRIST.survey_is_admin_confirmed',
  'a surveyed day is admin_confirmed, by the survey route, in the admin''s name');

-- The other route, for contrast: a leader's own confirmation stops at stage 1.
select pg_temp.ok(
  (select stage = 'leader_confirmed' and confirmed_via = 'leader'
   from public.project_day
   where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and work_date = app.stockholm_today() - 1),
  'BRIST.leader_route_stops_at_stage_1',
  'a leader-confirmed day is leader_confirmed; the stage is not the route');

-- It leaves the leader's queue and never comes back.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));
select pg_temp.rejects($$
  select public.complete_bristsurvey('aaaaaaaa-0000-0000-0000-00000000000a',
                                     app.stockholm_today() - 2, 'Något annat')
$$, 'BRIST.surveyed_day_is_final');

-- And the survey is not a bypass of the no-empty-cells rule -- it is the
-- manual way of satisfying it. The range that was blocked above now generates.
insert into public.arbetsdagbok (project_id, covered, generated_by)
values ('aaaaaaaa-0000-0000-0000-00000000000a',
        daterange(app.stockholm_today() - 5, app.stockholm_today(), '[)'),
        (select v from fx where k = 'admin'));

reset role;

select pg_temp.ok(
  (select count(*) from public.arbetsdagbok
   where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and covered = daterange(app.stockholm_today() - 5, app.stockholm_today(), '[)')) = 1,
  'BRIST.survey_unblocks_generation',
  'completing the survey satisfies invariant 6 for the range that was blocked');

-- Nothing is left in the way afterwards.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));
select pg_temp.ok(
  (select jsonb_array_length(g->'days') = 0 and g->'project'->'missing' = '[]'::jsonb
   from public.bristsurvey_gaps('aaaaaaaa-0000-0000-0000-00000000000a',
                                app.stockholm_today() - 5, app.stockholm_today() - 1) g),
  'BRIST.no_gaps_after_survey', 'a surveyed range reports nothing left in the way');
reset role;

-- ============================================================================
-- STAGE 2 -- the admin reviews the claim; he never makes one
--
-- Project B's yesterday, kept deliberately off project A: a rejection reopens a
-- day, and the document assertions above rest on project A's days staying shut.
--
-- Three outcomes and no fourth: approve, edit and approve, reject and send
-- back. Everything here turns on the difference between reviewing a claim and
-- making one -- the admin may accept, correct or refuse the leader's
-- confirmation, and at no point may he author one.
-- ============================================================================

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderB'));

update public.tilldelning set confirmed_hours = 8.00
where pass_id = 'cccccccc-0000-0000-0000-000000000002' and released_at is null;

insert into public.project_day (project_id, work_date, vad_vi_gjorde,
                                confirmed_at, confirmed_by, confirmed_via)
values ('bbbbbbbb-0000-0000-0000-00000000000b', app.stockholm_today() - 1,
        'Bar in material och städade.', now(),
        (select v from fx where k='leaderB'), 'leader');

reset role;

select pg_temp.ok(
  (select stage = 'leader_confirmed' and reviewed_at is null and rejected_at is null
   from public.project_day
   where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
     and work_date = app.stockholm_today() - 1),
  'STAGE2.arrives_in_the_queue',
  'a leader''s confirmation lands at stage 1 and waits to be reviewed');

-- Stage 1 is final FOR THE LEADER. They cannot sign off their own claim, and
-- they cannot send it back to themselves either.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderB'));

select pg_temp.rejects($$
  update public.project_day set stage = 'admin_confirmed'
  where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
    and work_date = app.stockholm_today() - 1
$$, 'STAGE2.leader_cannot_approve');

select pg_temp.rejects($$
  select public.reject_day('bbbbbbbb-0000-0000-0000-00000000000b',
                           app.stockholm_today() - 1, 'Fel tider')
$$, 'STAGE2.leader_cannot_reject');

select pg_temp.act_as((select v from fx where k = 'admin'));

-- A rejection with no reason is a day sent back to be re-confirmed exactly as
-- it was. Written straight at the table rather than through reject_day, which
-- refuses a blank note itself: the guard behind it has to refuse one too.
select pg_temp.rejects($$
  update public.project_day set stage = null, rejection_note = '   '
  where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
    and work_date = app.stockholm_today() - 1
$$, 'STAGE2.reject_needs_note');

-- Reject and send back. The only route that reopens a confirmed day.
select public.reject_day('bbbbbbbb-0000-0000-0000-00000000000b',
                         app.stockholm_today() - 1,
                         'Timmarna stämmer inte med stämplingarna.');
reset role;

select pg_temp.ok(
  (select confirmed_at is null and stage is null and confirmed_via is null
      and confirmed_by is null
      and rejected_by = (select v from fx where k='admin')
      and rejection_note = 'Timmarna stämmer inte med stämplingarna.'
      and vad_vi_gjorde = 'Bar in material och städade.'
   from public.project_day
   where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
     and work_date = app.stockholm_today() - 1),
  'STAGE2.rejection_reopens_the_day',
  'a rejected day loses its confirmation, keeps its text, and carries the note');

select pg_temp.ok(
  (select count(*) = 1 from public.day_review
   where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
     and work_date = app.stockholm_today() - 1
     and action = 'rejected'
     and note = 'Timmarna stämmer inte med stämplingarna.'
     and acted_by = (select v from fx where k='admin')),
  'STAGE2.rejection_is_logged', 'every stage 2 act is appended to the log');

-- The day is back in the leader's hands: the figures move again, and so does
-- the day. What does not move is the record that it came back.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderB'));

update public.tilldelning set confirmed_hours = 6.50
where pass_id = 'cccccccc-0000-0000-0000-000000000002' and released_at is null;

update public.project_day
set vad_vi_gjorde = 'Bar in material, städade och rev ställning.',
    confirmed_at  = now(),
    confirmed_by  = (select v from fx where k='leaderB'),
    confirmed_via = 'leader'
where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
  and work_date = app.stockholm_today() - 1;

reset role;

select pg_temp.ok(
  (select pd.stage = 'leader_confirmed' and pd.rejected_at is not null
      and (select t.confirmed_hours = 6.50 from public.tilldelning t
           where t.pass_id = 'cccccccc-0000-0000-0000-000000000002'
             and t.released_at is null)
   from public.project_day pd
   where pd.project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
     and pd.work_date = app.stockholm_today() - 1),
  'STAGE2.rejection_puts_the_day_back',
  'a rejected day is the leader''s again, and the record still says it came back');

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));

-- REVIEWING A CLAIM IS NOT MAKING ONE. The admin may approve the confirmation
-- in front of him; he may not put his own name on it.
select pg_temp.rejects($$
  update public.project_day
  set stage = 'admin_confirmed', confirmed_by = (select v from fx where k='admin')
  where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
    and work_date = app.stockholm_today() - 1
$$, 'STAGE2.claim_stays_the_leaders');

-- Edit and approve: one outcome, therefore one write. The corrections and the
-- approval commit together or not at all.
select public.approve_day(
  'bbbbbbbb-0000-0000-0000-00000000000b', app.stockholm_today() - 1,
  'Bar in material, städade och rev ställning på baksidan.',
  jsonb_build_array(jsonb_build_object(
    -- The WORKER's row. Step 4b puts the project's arbetsledare on this day
    -- too, and a bare pass_id now matches both.
    'tilldelning', (select t.id from public.tilldelning t
                    where t.pass_id = 'cccccccc-0000-0000-0000-000000000002'
                      and t.released_at is null
                      and t.source <> 'ledare'),
    'pass',   'cccccccc-0000-0000-0000-000000000002',
    'hours',  7.25,
    'start',  '07:00',
    'end',    '15:30')));

reset role;

select pg_temp.ok(
  (select stage = 'admin_confirmed'
      and confirmed_via = 'leader'
      and confirmed_by  = (select v from fx where k='leaderB')
      and reviewed_by   = (select v from fx where k='admin')
      and reviewed_at is not null
      and vad_vi_gjorde = 'Bar in material, städade och rev ställning på baksidan.'
   from public.project_day
   where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
     and work_date = app.stockholm_today() - 1),
  'STAGE2.edit_and_approve',
  'approval moves the stage and names the reviewer; the claim stays the leader''s');

select pg_temp.ok(
  (select confirmed_hours = 7.25 from public.tilldelning
   where pass_id = 'cccccccc-0000-0000-0000-000000000002' and released_at is null),
  'STAGE2.admin_hours_stand', 'the figures the admin corrected are the ones that stand');

select pg_temp.ok(
  (select start_time = '07:00'::time and end_time = '15:30'::time
   from public.pass where id = 'cccccccc-0000-0000-0000-000000000002'),
  'STAGE2.admin_times_stand', 'PASS TIDER is a cell of the document and moves with the rest');

-- INVARIANT 5, the second wall. Once admin_confirmed, nothing edits it -- not
-- the text, not the hours, not the times, and it cannot be sent back either.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));

select pg_temp.rejects($$
  update public.project_day set vad_vi_gjorde = 'efterhandsändring'
  where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
    and work_date = app.stockholm_today() - 1
$$, 'STAGE2.approved_day_is_final');

select pg_temp.rejects($$
  update public.tilldelning set confirmed_hours = 12.00
  where pass_id = 'cccccccc-0000-0000-0000-000000000002' and released_at is null
$$, 'STAGE2.hours_final_after_approval');

select pg_temp.rejects($$
  update public.pass set start_time = '05:00'
  where id = 'cccccccc-0000-0000-0000-000000000002'
$$, 'STAGE2.times_final_after_approval');

select pg_temp.rejects($$
  select public.reject_day('bbbbbbbb-0000-0000-0000-00000000000b',
                           app.stockholm_today() - 1, 'För sent')
$$, 'STAGE2.approved_day_cannot_be_sent_back');

-- BEKRÄFTELSE HISTORIK -- one definition, read by both roles, showing current
-- values rather than whatever a document once printed.
select pg_temp.ok(
  (select stage = 'admin_confirmed' and confirmed_via = 'leader'
      and confirmed_by_name is not null and reviewed_by_name is not null
      and vad_vi_gjorde = 'Bar in material, städade och rev ställning på baksidan.'
   from public.day_history
   where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
     and work_date = app.stockholm_today() - 1),
  'STAGE2.historik_shows_current_values',
  'the historik reads live values, not the ones a document printed');

select pg_temp.act_as((select v from fx where k = 'leaderB'));

select pg_temp.ok(
  (select count(*) = 1 from public.day_history
   where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
     and work_date = app.stockholm_today() - 1),
  'STAGE2.historik_readable_by_the_leader',
  'the leader can read the log of their own days, not only the admin');

select pg_temp.ok(
  (select count(*) = 2 from public.day_review
   where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'
     and work_date = app.stockholm_today() - 1),
  'STAGE2.log_holds_both_acts', 'the rejection and the approval are both in the log');

select pg_temp.rejects($$
  insert into public.day_review (project_id, work_date, action, acted_by)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', app.stockholm_today() - 1,
          'approved', (select v from fx where k='leaderB'))
$$, 'STAGE2.log_is_append_only_by_the_guard');

select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.ok(
  (select count(*) = 0 from public.day_history
   where project_id = 'bbbbbbbb-0000-0000-0000-00000000000b'),
  'STAGE2.historik_scoped_to_your_projects',
  'a leader reads the log for the projects they are on and no others');

reset role;

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
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000004' and t.released_at is null
     and t.source <> 'ledare') = 0,
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

-- ============================================================================
-- THE VACANCY CASCADE -- Step 5b
--
-- Removing a worker is not a correction to the demand. The slot reopens, the
-- headcount does not drop, and the slot walks back down the same list --
-- unless the shift is inside five days, when nothing fires automatically.
-- ============================================================================

-- A pass far enough out that the cascade is allowed to run, with one more
-- willing worker than it has slots, so a refill is possible and visible.
insert into public.forval (worker_id, work_date, can_work)
select w.id, app.stockholm_today() + 60, true
from public.worker w join fx on fx.v = w.account_id where fx.k in ('w1', 'w2', 'w3');

insert into public.pass_batch (id, project_id, created_by)
select 'ffffffff-0000-0000-0000-00000000000e', 'aaaaaaaa-0000-0000-0000-00000000000a',
       (select v from fx where k = 'leaderA');

insert into public.pass (id, project_id, batch_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select 'eeeeeeee-0000-0000-0000-000000000010'::uuid,
       'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
       'ffffffff-0000-0000-0000-00000000000e'::uuid,
       app.stockholm_today() + 60, '07:00'::time, '16:00'::time, 8.00, 2::smallint,
       (select v from fx where k = 'leaderA');

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select public.fill_passes('ffffffff-0000-0000-0000-00000000000e');
reset role;

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000010' and t.released_at is null
     and t.source <> 'ledare') = 2,
  'CASCADE.filled_to_start', 'the pass starts full, so a removal has something to reopen');

-- Take one of them off.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
create temporary table cascade_far as
select * from public.release_assignment(
  -- A WORKER's row. `limit 1` would otherwise be free to hand back the
  -- arbetsledare's, and this test is about a vacated slot.
  (select t.id from public.tilldelning t
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000010' and t.released_at is null
     and t.source <> 'ledare' limit 1));
grant select on cascade_far to public;
reset role;

select pg_temp.ok((select reopened from cascade_far),
  'CASCADE.reopens_beyond_five_days',
  'more than five days out, the vacated slot walks back down the list');

select pg_temp.ok((select filled from cascade_far) = 1,
  'CASCADE.refilled_from_forval',
  'the third willing worker took the reopened slot');

select pg_temp.ok(
  (select headcount from public.pass where id = 'eeeeeeee-0000-0000-0000-000000000010') = 2,
  'CASCADE.headcount_never_drops',
  'the pass still needs the same number of people');

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000010' and t.released_at is null
     and t.source <> 'ledare') = 2,
  'CASCADE.back_to_full', 'the slot was filled, not lost');

select pg_temp.ok(
  (select count(*) from public.pass_block b
   where b.pass_id = 'eeeeeeee-0000-0000-0000-000000000010') = 1,
  'CASCADE.removed_not_reoffered',
  'the person taken off is never offered that pass again');

-- ---- inside five days, nothing fires --------------------------------------
insert into public.forval (worker_id, work_date, can_work)
select w.id, app.stockholm_today() + 2, true
from public.worker w join fx on fx.v = w.account_id where fx.k in ('w2', 'w3');

insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select 'eeeeeeee-0000-0000-0000-000000000011'::uuid,
       'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
       app.stockholm_today() + 2, '07:00'::time, '16:00'::time, 8.00, 1::smallint,
       (select v from fx where k = 'leaderA');

insert into public.tilldelning (id, pass_id, worker_id, source, work_date)
select 'dddddddd-0000-0000-0000-000000000020', 'eeeeeeee-0000-0000-0000-000000000011',
       w.id, 'manuell', app.stockholm_today() + 2
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w2';

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
create temporary table cascade_near as
select * from public.release_assignment('dddddddd-0000-0000-0000-000000000020');
grant select on cascade_near to public;
reset role;

select pg_temp.ok((select reopened from cascade_near) = false,
  'CASCADE.no_autofill_inside_five_days',
  'nobody is ready for a last-minute change and the system does not pretend otherwise');

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000011' and t.released_at is null
     and t.source <> 'ledare') = 0,
  'CASCADE.left_short_inside_five_days',
  'w3 was willing and free, and was still not placed automatically');

select pg_temp.ok(
  (select count(*) from public.pass_offer o
   where o.pass_id = 'eeeeeeee-0000-0000-0000-000000000011') = 0,
  'CASCADE.no_offers_inside_five_days', 'and no Acceptera Pass went out either');

-- ============================================================================
-- BATCH INSTANCES ARE INDEPENDENT
--
-- Two template rows across two days is four passes, not a series. Editing one
-- must not reach the others -- there is no shared object to edit through.
-- ============================================================================
insert into public.pass_batch (id, project_id, created_by)
select 'ffffffff-0000-0000-0000-00000000000f', 'aaaaaaaa-0000-0000-0000-00000000000a',
       (select v from fx where k = 'leaderA');

insert into public.pass (id, project_id, batch_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select g.id::uuid,
       'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
       'ffffffff-0000-0000-0000-00000000000f'::uuid,
       g.d, g.st::time, g.en::time, 8.00, 1::smallint,
       (select v from fx where k = 'leaderA')
from (values
  ('eeeeeeee-0000-0000-0000-000000000021', app.stockholm_today() + 70, '07:00', '16:00'),
  ('eeeeeeee-0000-0000-0000-000000000022', app.stockholm_today() + 70, '14:00', '22:00'),
  ('eeeeeeee-0000-0000-0000-000000000023', app.stockholm_today() + 71, '07:00', '16:00'),
  ('eeeeeeee-0000-0000-0000-000000000024', app.stockholm_today() + 71, '14:00', '22:00')
) as g(id, d, st, en);

select pg_temp.ok(
  (select count(*) from public.pass where batch_id = 'ffffffff-0000-0000-0000-00000000000f') = 4,
  'BATCH.two_rows_two_days_is_four_passes',
  'every template row applies to every selected day');

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
update public.pass
set start_time = '05:30', planned_hours = 3.25, headcount = 4
where id = 'eeeeeeee-0000-0000-0000-000000000021';
reset role;

select pg_temp.ok(
  (select start_time = '05:30' and planned_hours = 3.25 and headcount = 4
   from public.pass where id = 'eeeeeeee-0000-0000-0000-000000000021'),
  'BATCH.edit_lands_on_the_instance', 'the edited pass changed');

select pg_temp.ok(
  (select count(*) from public.pass
   where batch_id = 'ffffffff-0000-0000-0000-00000000000f'
     and id <> 'eeeeeeee-0000-0000-0000-000000000021'
     and start_time in ('07:00', '14:00') and planned_hours = 8.00 and headcount = 1) = 3,
  'BATCH.siblings_untouched',
  'the other three instances kept their own times, hours and headcount');

-- ============================================================================
-- SNABB PASS -- the escape hatch. Step 7.
--
-- Skips the picking, never the confirming.
-- ============================================================================

-- w3 already works that day on an ordinary pass. The Snabb Pass must win.
insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select 'eeeeeeee-0000-0000-0000-000000000030'::uuid,
       'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
       app.stockholm_today() - 10, '07:00'::time, '16:00'::time, 8.00, 1::smallint,
       (select v from fx where k = 'leaderA');

insert into public.tilldelning (id, pass_id, worker_id, source, work_date)
select 'dddddddd-0000-0000-0000-000000000030', 'eeeeeeee-0000-0000-0000-000000000030',
       w.id, 'manuell', app.stockholm_today() - 10
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w3';

-- Created by the ADMIN. Section 2 and Step 7 once disagreed; Section 2 was
-- right, because creating one is inseparable from adding someone off-roster,
-- and that is an account-creation power the arbetsledare does not have.
create temporary table snabb_call(ok boolean, err text);
-- The DO block below runs as `authenticated`, so it needs INSERT as well as
-- SELECT on this temp table: it belongs to the session user, not to them.
grant select, insert on snabb_call to public;

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));
do $snabb$
begin
  perform public.create_snabb_pass(
    'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
    (select id from wid where k = 'w3'),
    app.stockholm_today() - 10, '13:00'::time, '19:00'::time, 5.50);
  insert into snabb_call values (true, null);
exception when others then
  insert into snabb_call values (false, sqlerrm);
end $snabb$;
reset role;

select pg_temp.ok((select ok from snabb_call),
  'SNABB.admin_may_create',
  'the admin creates a Snabb Pass: ' || coalesce((select err from snabb_call), ''));

-- The arbetsledare assigned to this very project is still refused.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.rejects($$
  select public.create_snabb_pass(
    'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
    (select id from wid where k = 'w2'),
    app.stockholm_today() + 83, '07:00'::time, '16:00'::time, 8.00)
$$, 'SNABB.leader_cannot_create');
reset role;

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   join public.worker w on w.id = t.worker_id join fx on fx.v = w.account_id
   where fx.k = 'w3' and t.work_date = app.stockholm_today() - 10
     and t.released_at is null) = 1,
  'SNABB.one_assignment_stands',
  'INVARIANT 2 holds: exactly one live assignment that date');

select pg_temp.ok(
  (select t.released_reason = 'replaced_by_snabb' from public.tilldelning t
   where t.id = 'dddddddd-0000-0000-0000-000000000030'),
  'SNABB.releases_earlier_same_day',
  'the Snabb Pass wins and the earlier assignment is released');

select pg_temp.ok(
  (select t.source = 'snabb' from public.tilldelning t
   join public.worker w on w.id = t.worker_id join fx on fx.v = w.account_id
   where fx.k = 'w3' and t.work_date = app.stockholm_today() - 10
     and t.released_at is null),
  'SNABB.marked_snabb', 'how it entered is recorded, even though it prints the same');

-- ---- it bypasses the headcount, and nothing else does ---------------------
insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select 'eeeeeeee-0000-0000-0000-000000000031'::uuid,
       'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
       app.stockholm_today() + 80, '07:00'::time, '16:00'::time, 8.00, 1::smallint,
       (select v from fx where k = 'leaderA');

insert into public.tilldelning (pass_id, worker_id, source, work_date)
select 'eeeeeeee-0000-0000-0000-000000000031', w.id, 'manuell', app.stockholm_today() + 80
from public.worker w join fx on fx.v = w.account_id where fx.k = 'w1';

-- One slot, already taken. An ordinary assignment is refused...
select pg_temp.rejects($$
  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  select 'eeeeeeee-0000-0000-0000-000000000031', w.id, 'manuell', app.stockholm_today() + 80
  from public.worker w join fx on fx.v = w.account_id where fx.k = 'w2'
$$, 'SNABB.headcount_still_guards_others');

-- ...and a Snabb Pass is not.
-- Recorded rather than called bare: with the bypass removed the guard raises,
-- and a raw exception aborts the suite instead of failing THIS assertion --
-- which is what a control has to be able to do.
create temporary table snabb_full(ok boolean, err text);
grant select, insert on snabb_full to public;

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));
do $full$
begin
  perform public.assign_snabb('eeeeeeee-0000-0000-0000-000000000031',
    (select id from wid where k = 'w2'));
  insert into snabb_full values (true, null);
exception when others then
  insert into snabb_full values (false, sqlerrm);
end $full$;
reset role;

select pg_temp.ok(
  (select ok from snabb_full)
  and (select count(*) from public.tilldelning t
       where t.pass_id = 'eeeeeeee-0000-0000-0000-000000000031'
         and t.released_at is null
         and t.source <> 'ledare') = 2,
  'SNABB.bypasses_headcount',
  'covering a no-show on a full shift is exactly what the escape hatch is for: ' ||
  coalesce((select err from snabb_full), ''));

-- ---- but not on someone else's project, and not by a worker ---------------
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'w1'));
select pg_temp.rejects($$
  select public.create_snabb_pass(
    'aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
    (select id from wid where k = 'w2'),
    app.stockholm_today() + 82, '07:00'::time, '16:00'::time, 8.00)
$$, 'SNABB.worker_cannot_create');
reset role;

-- ---- it skips the picking, never the confirming ---------------------------
-- The day carries the ordinary pass (its worker released) and the Snabb Pass.
-- Confirming it must still demand hours for the Snabb row like any other.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.rejects($$
  insert into public.project_day (project_id, work_date, vad_vi_gjorde,
                                  confirmed_at, confirmed_by, confirmed_via)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() - 10,
          'Snabbinsats på taket', now(),
          (select v from fx where k='leaderA'), 'leader')
$$, 'SNABB.confirm_needs_its_hours');
reset role;

-- Scoped to this project's passes. Unscoped, it reaches every assignment on
-- that date across the whole database -- including days another project has
-- already confirmed, which are final and refuse the write.
update public.tilldelning t
set confirmed_hours = 5.50
where t.released_at is null
  and t.pass_id in (
    select p.id from public.pass p
    where p.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
      and p.work_date = app.stockholm_today() - 10
  );

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
insert into public.project_day (project_id, work_date, vad_vi_gjorde,
                                confirmed_at, confirmed_by, confirmed_via)
values ('aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() - 10,
        'Snabbinsats på taket', now(),
        (select v from fx where k='leaderA'), 'leader');
reset role;

select pg_temp.ok(
  (select confirmed_via = 'leader' from public.project_day
   where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and work_date = app.stockholm_today() - 10),
  'SNABB.enters_the_confirmation_queue',
  'a Snabb Pass confirms exactly like any other row');

-- INVARIANT 10, the case that separates confirmed from filed. This day is
-- confirmed, its hours are set, and no Arbetsdagbok covers it. The worker must
-- still see nothing: a confirmed figure can be edited at stage two, a filed one
-- cannot, and only the second has stopped moving.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'w3'));

select pg_temp.ok(
  (select day_confirmed and not filed and confirmed_hours is null
   from public.my_shift where work_date = app.stockholm_today() - 10),
  'I10.confirmed_is_not_enough',
  'confirmed but not filed: the day shows as confirmed and the hours stay hidden');

reset role;

-- ============================================================================
-- PROFIL -- the narrowest read in the database
--
-- Self or admin. NOT an arbetsledare: a leader is staff for everything to do
-- with shifts and nothing to do with a colleague's bank account.
-- ============================================================================

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'w1'));

insert into public.profile (account_id, telefon, clearingnummer, kontonummer)
values ((select v from fx where k = 'w1'), '070-1111111', '8327', '9941234');

select pg_temp.ok(
  (select telefon = '070-1111111' from public.profile
   where account_id = (select v from fx where k = 'w1')),
  'PROFILE.self_can_write', 'a worker fills in their own profile');

-- A colleague is a stranger to this row.
select pg_temp.act_as((select v from fx where k = 'w2'));
select pg_temp.ok(
  (select count(*) from public.profile
   where account_id = (select v from fx where k = 'w1')) = 0,
  'PROFILE.worker_cannot_read_colleague',
  'another arbetare must not see a colleague''s bank details');

-- An UPDATE blocked by RLS filters to zero rows rather than raising, so this
-- asserts on state and not on an exception.
update public.profile set telefon = '070-9999999'
where account_id = (select v from fx where k = 'w1');

select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.ok(
  (select count(*) from public.profile
   where account_id = (select v from fx where k = 'w1')) = 0,
  'PROFILE.leader_cannot_read_colleague',
  'an arbetsledare runs the shifts, not the payroll');

select pg_temp.act_as((select v from fx where k = 'admin'));
select pg_temp.ok(
  (select telefon = '070-1111111' from public.profile
   where account_id = (select v from fx where k = 'w1')),
  'PROFILE.admin_reads_all',
  'the admin sees it, and the colleague''s write never landed');

-- The Konton list needs an address for every account, including one with no
-- worker record. It can only come from auth.users.
select pg_temp.ok(
  (select email like '%@%' from public.account_directory
   where id = (select v from fx where k = 'admin')),
  'DIR.email_from_auth',
  'an account with no worker row still has an identity to show');

reset role;

-- ============================================================================
-- PAUSING AN ACCOUNT -- "the current shift is their last"
-- ============================================================================

-- One shift already running, one still to come, and an offer outstanding.
insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select p.a, 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid, p.b, p.c, p.d, p.e, p.f,
       (select v from fx where k = 'leaderA')
from (values
  -- Started at midnight and running until just before the next: by the clock
  -- this one is happening right now, whenever "now" is.
  ('cccccccc-0000-0000-0000-000000000006'::uuid, app.stockholm_today(),
   '00:00'::time, '23:59'::time, 8.00::numeric, 1::smallint),
  ('cccccccc-0000-0000-0000-000000000007', app.stockholm_today() + 25,
   '07:00', '16:00', 8.00, 2),
  ('cccccccc-0000-0000-0000-000000000008', app.stockholm_today() + 26,
   '07:00', '16:00', 8.00, 1)
) as p(a, b, c, d, e, f);

insert into public.tilldelning (id, pass_id, worker_id, source, work_date)
values
  ('dddddddd-0000-0000-0000-000000000006',
   'cccccccc-0000-0000-0000-000000000006', (select id from wid where k = 'w2'),
   'manuell', app.stockholm_today()),
  ('dddddddd-0000-0000-0000-000000000007',
   'cccccccc-0000-0000-0000-000000000007', (select id from wid where k = 'w2'),
   'manuell', app.stockholm_today() + 25);

insert into public.pass_offer (pass_id, worker_id)
values ('cccccccc-0000-0000-0000-000000000008', (select id from wid where k = 'w2'));

-- The pause is made by the admin, through the ordinary column. The release it
-- triggers runs as whoever pressed the button, and a release needs someone who
-- leads the project -- which is why this cannot be done as the database owner
-- with no auth.uid() at all.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));
update public.account set active = false where id = (select v from fx where k = 'w2');
reset role;

select pg_temp.ok(
  (select released_at is not null and released_reason = 'account_paused'
   from public.tilldelning where id = 'dddddddd-0000-0000-0000-000000000007'),
  'PAUSE.releases_future',
  'a shift that has not started is released, and the record says why');

select pg_temp.ok(
  (select released_at is null
   from public.tilldelning where id = 'dddddddd-0000-0000-0000-000000000006'),
  'PAUSE.keeps_started_shift',
  'a shift they are standing on is theirs; it is hours they actually worked');

select pg_temp.ok(
  (select state = 'withdrawn' from public.pass_offer
   where pass_id = 'cccccccc-0000-0000-0000-000000000008'
     and worker_id = (select id from wid where k = 'w2')),
  'PAUSE.withdraws_offers',
  'an open offer to a paused person is a question they cannot answer');

-- And the walk stops considering them. w2 has marked this day can-work and
-- nobody else has, so an active w2 would take the slot outright; a paused one
-- must not even be offered it down Tier 3.
insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
values ('cccccccc-0000-0000-0000-000000000009',
        'aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() + 27,
        '07:00', '16:00', 8.00, 1, (select v from fx where k = 'leaderA'));

insert into public.forval (worker_id, work_date, can_work)
values ((select id from wid where k = 'w2'), app.stockholm_today() + 27, true);

select app.fill_pass('cccccccc-0000-0000-0000-000000000009');

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.pass_id = 'cccccccc-0000-0000-0000-000000000009'
     and t.worker_id = (select id from wid where k = 'w2')) = 0
  and
  (select count(*) from public.pass_offer o
   where o.pass_id = 'cccccccc-0000-0000-0000-000000000009'
     and o.worker_id = (select id from wid where k = 'w2')) = 0,
  'PAUSE.excluded_from_tier_walk',
  'a paused account is neither assigned nor offered a future shift');

-- Unpausing makes them assignable again. It does not claw back the slot: the
-- release stands, and pass_block keeps them off that particular shift.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));
update public.account set active = true where id = (select v from fx where k = 'w2');
reset role;

select pg_temp.ok(
  (select released_at is not null
   from public.tilldelning where id = 'dddddddd-0000-0000-0000-000000000007'),
  'PAUSE.unpause_does_not_restore',
  'unpausing returns the person, not the shift someone else may now hold');

-- ============================================================================
-- AVBOKA PASS on a worker -- Step 5b
--
-- Four passes, because the rule has two axes and both matter: is anyone free,
-- and is the shift inside five days. The popup fires on the first alone; the
-- Acceptera Pass cards need both.
-- ============================================================================

insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select p.a, 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid, p.b, '07:00'::time, '16:00'::time,
       8.00::numeric, 1::smallint, (select v from fx where k = 'leaderA')
from (values
  ('cccccccc-0000-0000-0000-00000000000a'::uuid, app.stockholm_today() + 30),  -- far, someone free
  ('cccccccc-0000-0000-0000-00000000000b', app.stockholm_today() + 31),        -- far, nobody free
  ('cccccccc-0000-0000-0000-00000000000c', app.stockholm_today() + 3),         -- near, someone free
  ('cccccccc-0000-0000-0000-00000000000d', app.stockholm_today() + 4),         -- near, nobody free
  ('cccccccc-0000-0000-0000-00000000000e', app.stockholm_today() + 30)         -- to keep w3 busy
) as p(a, b);

insert into public.tilldelning (id, pass_id, worker_id, source, work_date)
values
  ('dddddddd-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-00000000000a',
   (select id from wid where k = 'w1'), 'forval', app.stockholm_today() + 30),
  ('dddddddd-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-00000000000b',
   (select id from wid where k = 'w1'), 'forval', app.stockholm_today() + 31),
  ('dddddddd-0000-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-00000000000c',
   (select id from wid where k = 'w1'), 'forval', app.stockholm_today() + 3),
  ('dddddddd-0000-0000-0000-00000000000d', 'cccccccc-0000-0000-0000-00000000000d',
   (select id from wid where k = 'w1'), 'forval', app.stockholm_today() + 4),
  -- w3 marked the same day AND is working it. They are the control for the
  -- exclusion: free means free, not merely willing.
  ('dddddddd-0000-0000-0000-00000000000e', 'cccccccc-0000-0000-0000-00000000000e',
   (select id from wid where k = 'w3'), 'forval', app.stockholm_today() + 30);

-- w2 is free on the two "someone free" days and on nothing else.
insert into public.forval (worker_id, work_date, can_work)
values
  ((select id from wid where k = 'w2'), app.stockholm_today() + 30, true),
  ((select id from wid where k = 'w2'), app.stockholm_today() + 3,  true),
  ((select id from wid where k = 'w3'), app.stockholm_today() + 30, true);

set local role authenticated;

-- A leader on another project cannot take someone off this one.
select pg_temp.act_as((select v from fx where k = 'leaderB'));
select pg_temp.rejects($$
  select public.avboka_pass('dddddddd-0000-0000-0000-00000000000a')
$$, 'AVBOKA.other_leader_refused');

select pg_temp.act_as((select v from fx where k = 'leaderA'));

-- ---- far, and someone is free: the popup, and nothing automatic -----------
select pg_temp.ok(
  -- On the id alone: this runs as leaderA, and worker's own policy lets a
  -- leader read exactly one row -- their own. Looking the name up here would
  -- return NULL and fail an assertion about something else entirely.
  (select (g->'replacements') @> jsonb_build_array(
            jsonb_build_object('worker_id', (select id from wid where k = 'w2')))
   from public.avboka_pass('dddddddd-0000-0000-0000-00000000000a') g),
  'AVBOKA.popup_lists_free_forval',
  'whoever marked the day and is not working it is offered as a replacement');

-- The other half of the same sentence. w3 marked this day too and is standing
-- on another shift on it, so they are not available to take this one.
select pg_temp.ok(
  (select not ((g->'replacements') @> jsonb_build_array(
                 jsonb_build_object('worker_id', (select id from wid where k = 'w3'))))
   -- The same pass again: w3's day is +30, and asking about any other day
   -- would be a question w3 could not appear in whatever the filter did.
   -- Releasing an already-released row is a no-op, so this just recomputes.
   from public.avboka_pass('dddddddd-0000-0000-0000-00000000000a') g),
  'AVBOKA.busy_forval_not_offered',
  'someone already working that day is not a replacement, however they marked it');

reset role;

select pg_temp.ok(
  -- Slots, not rows. The project still has w3 on this date, so Step 4b's
  -- arbetsledare row is legitimately sitting on this pass.
  (select count(*) from public.tilldelning t
   where t.pass_id = 'cccccccc-0000-0000-0000-00000000000a' and t.released_at is null
     and t.source <> 'ledare') = 0,
  'AVBOKA.no_autofill_when_someone_free',
  'the slot waits for the leader to choose; it does not fill itself');

select pg_temp.ok(
  (select count(*) from public.pass_offer o
   where o.pass_id = 'cccccccc-0000-0000-0000-00000000000a') = 0,
  'AVBOKA.no_cards_when_someone_free',
  'the cards are for having nobody to ask, and there was somebody');

-- Picking a name fills it on the spot.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select public.place_replacement('cccccccc-0000-0000-0000-00000000000a',
                                (select id from wid where k = 'w2'));
reset role;

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.pass_id = 'cccccccc-0000-0000-0000-00000000000a'
     and t.worker_id = (select id from wid where k = 'w2')
     and t.released_at is null and t.source = 'manuell') = 1,
  'AVBOKA.place_fills_the_slot', 'the chosen replacement takes the place');

select pg_temp.ok(
  (select headcount from public.pass where id = 'cccccccc-0000-0000-0000-00000000000a') = 1,
  'AVBOKA.headcount_never_drops', 'the pass still needs the same number of people');

-- ---- far, and nobody is free: no popup, cards go out ----------------------
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.ok(
  (select g->'replacements' = '[]'::jsonb and (g->>'beyond_five_days')::boolean
          and (g->>'offered')::int > 0
   from public.avboka_pass('dddddddd-0000-0000-0000-00000000000b') g),
  'AVBOKA.cards_when_nobody_free',
  'with nobody to ask, the slot goes straight out as Acceptera Pass');
reset role;

select pg_temp.ok(
  (select count(*) from public.pass_offer o
   where o.pass_id = 'cccccccc-0000-0000-0000-00000000000b' and o.state = 'offered') > 0,
  'AVBOKA.offers_exist', 'and the offers are really there');

select pg_temp.ok(
  (select count(*) from public.pass_offer o
   where o.pass_id = 'cccccccc-0000-0000-0000-00000000000b'
     and o.worker_id = (select id from wid where k = 'w1')) = 0,
  'AVBOKA.removed_not_offered_back',
  'the person taken off is never offered their own slot back');

-- ---- near, and someone is free: the popup STILL fires ---------------------
-- Choosing a name is manual placement, which Step 5 allows however close the
-- shift is. This is the assertion that separates the two halves of the rule.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.ok(
  (select jsonb_array_length(g->'replacements') > 0
          and not (g->>'beyond_five_days')::boolean
          and (g->>'offered')::int = 0
   from public.avboka_pass('dddddddd-0000-0000-0000-00000000000c') g),
  'AVBOKA.popup_inside_five_days',
  'inside five days the popup fires and the cards do not');
reset role;

select pg_temp.ok(
  (select count(*) from public.pass_offer o
   where o.pass_id = 'cccccccc-0000-0000-0000-00000000000c') = 0,
  'AVBOKA.no_cards_inside_five_days', 'nothing automatic went out that close in');

-- ---- near, and nobody is free: nothing at all -----------------------------
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.ok(
  (select g->'replacements' = '[]'::jsonb and (g->>'offered')::int = 0
   from public.avboka_pass('dddddddd-0000-0000-0000-00000000000d') g),
  'AVBOKA.nothing_inside_five_days_with_nobody',
  'the day runs short-staffed, which is a fact and not an error');
reset role;

-- ============================================================================
-- STEP 4b -- the arbetsledare is placed automatically
--
-- The row exists because workers are there. Everything asserted below follows
-- from that one sentence: it appears with the first worker, spans the whole of
-- what the workers span, occupies no slot, and goes when the last of them does.
--
-- Runs last, and adds leaderA to project B on the way, so the extra scope
-- cannot reach any assertion above it.
-- ============================================================================

insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
values
  -- +60: one project, two shifts. The envelope must be 06:00 -> 16:00.
  ('fafafafa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
   app.stockholm_today() + 120, '07:00', '16:00', 8.00, 1,
   (select v from fx where k = 'leaderA')),
  ('fafafafa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a',
   app.stockholm_today() + 120, '06:00', '14:00', 7.50, 1,
   (select v from fx where k = 'leaderA')),
  -- +61: leaderA is working as a worker elsewhere that day.
  ('fafafafa-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-00000000000b',
   app.stockholm_today() + 121, '08:00', '17:00', 8.00, 1,
   (select v from fx where k = 'leaderB')),
  ('fafafafa-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-00000000000a',
   app.stockholm_today() + 121, '07:00', '16:00', 8.00, 1,
   (select v from fx where k = 'leaderA')),
  -- +62: both projects have people, and leaderA runs both.
  ('fafafafa-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-00000000000a',
   app.stockholm_today() + 122, '07:00', '16:00', 8.00, 1,
   (select v from fx where k = 'leaderA')),
  ('fafafafa-0000-0000-0000-000000000006', 'bbbbbbbb-0000-0000-0000-00000000000b',
   app.stockholm_today() + 122, '09:00', '18:00', 8.00, 1,
   (select v from fx where k = 'leaderB'));

insert into public.tilldelning (id, pass_id, worker_id, source)
values
  ('fbfbfbfb-0000-0000-0000-000000000001', 'fafafafa-0000-0000-0000-000000000001',
   (select id from wid where k = 'w1'), 'manuell'),
  ('fbfbfbfb-0000-0000-0000-000000000002', 'fafafafa-0000-0000-0000-000000000002',
   (select id from wid where k = 'w2'), 'manuell');

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date = app.stockholm_today() + 120
     and t.source = 'ledare' and t.released_at is null
     and t.worker_id = (select id from wid where k = 'leaderA')) = 1,
  'STEP4B.leader_placed',
  'a worker holding a slot puts that projects arbetsledare on the day');

select pg_temp.ok(
  (select t.own_start = '06:00'::time and t.own_end = '16:00'::time
   from public.tilldelning t
   where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date = app.stockholm_today() + 120
     and t.source = 'ledare' and t.released_at is null),
  'STEP4B.envelope_is_the_workers_span',
  'earliest start to latest end across every worker on that project that day');

-- The row hangs on the day's earliest pass, whose headcount is 1 and whose one
-- slot is w2's. Both rows are there and the guard never fired.
select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.pass_id = 'fafafafa-0000-0000-0000-000000000002'
     and t.released_at is null and t.source <> 'ledare') = 1
  and (select count(*) from public.tilldelning t
       where t.pass_id = 'fafafafa-0000-0000-0000-000000000002'
         and t.released_at is null and t.source = 'ledare') = 1,
  'STEP4B.no_headcount_consumed',
  'the leaders row was never a slot the pass demanded');

update public.pass set start_time = '05:00'
where id = 'fafafafa-0000-0000-0000-000000000002';

select pg_temp.ok(
  (select t.own_start = '05:00'::time from public.tilldelning t
   where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date = app.stockholm_today() + 120
     and t.source = 'ledare' and t.released_at is null),
  'STEP4B.envelope_follows_an_edit',
  'the span is the workers, so it moves when their times do');

-- ---- a leader already working as a worker that day is not placed ----------
insert into public.tilldelning (pass_id, worker_id, source)
values ('fafafafa-0000-0000-0000-000000000003',
        (select id from wid where k = 'leaderA'), 'manuell');
insert into public.tilldelning (pass_id, worker_id, source)
values ('fafafafa-0000-0000-0000-000000000004',
        (select id from wid where k = 'w1'), 'manuell');

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.worker_id = (select id from wid where k = 'leaderA')
     and t.work_date = app.stockholm_today() + 121
     and t.source = 'ledare' and t.released_at is null) = 0,
  'STEP4B.busy_leader_not_placed',
  'the exception is two PROJECTS, not a leader working a shift as a worker');

-- ---- invariant 2's exception: one day on each project they run ------------
insert into public.project_leader (project_id, account_id)
values ('bbbbbbbb-0000-0000-0000-00000000000b', (select v from fx where k = 'leaderA'));

insert into public.tilldelning (pass_id, worker_id, source)
values ('fafafafa-0000-0000-0000-000000000005',
        (select id from wid where k = 'w1'), 'manuell');
insert into public.tilldelning (pass_id, worker_id, source)
values ('fafafafa-0000-0000-0000-000000000006',
        (select id from wid where k = 'w2'), 'manuell');

select pg_temp.ok(
  (select count(distinct t.project_id) from public.tilldelning t
   where t.worker_id = (select id from wid where k = 'leaderA')
     and t.work_date = app.stockholm_today() + 122
     and t.source = 'ledare' and t.released_at is null) = 2,
  'STEP4B.two_projects_one_day',
  'a leader running two projects with people on them holds a day on each');

-- leaderB leads project B and has no worker record at all. Nothing to place,
-- and nothing wrong.
select pg_temp.ok(
  (select count(*) from public.tilldelning t
   join public.worker w on w.id = t.worker_id
   where w.account_id = (select v from fx where k = 'leaderB')
     and t.source = 'ledare') = 0,
  'STEP4B.no_worker_record_is_not_placed',
  'an arbetsledare who never works shifts has no row to place');

-- ---- the row goes when the reason for it goes, and comes back with it -----
update public.tilldelning set released_at = now(), released_reason = 'removed_by_leader'
where id in ('fbfbfbfb-0000-0000-0000-000000000001', 'fbfbfbfb-0000-0000-0000-000000000002');

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date = app.stockholm_today() + 120
     and t.source = 'ledare' and t.released_at is null) = 0
  and (select count(*) from public.tilldelning t
       where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
         and t.work_date = app.stockholm_today() + 120
         and t.source = 'ledare'
         and t.released_reason = 'no_workers_left') = 1,
  'STEP4B.released_when_last_worker_leaves',
  'the row existed because workers were there, and they are not');

insert into public.tilldelning (pass_id, worker_id, source)
values ('fafafafa-0000-0000-0000-000000000001',
        (select id from wid where k = 'w3'), 'manuell');

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date = app.stockholm_today() + 120
     and t.source = 'ledare' and t.released_at is null) = 1,
  'STEP4B.comes_back_when_the_day_does',
  'a row released because the basis vanished is not a deliberate removal');

-- ---- and the worker's route off a shift is not the leader's ---------------
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.rejects($ar$
  select public.avboka_pass(
    (select t.id from public.tilldelning t
     where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
       and t.work_date = app.stockholm_today() + 120
       and t.source = 'ledare' and t.released_at is null))
$ar$, 'STEP4B.avboka_refuses_a_leader');
reset role;

-- ============================================================================
-- The surveyed day's arbetsledare figure -- checked here, after STEP 4b
--
-- Deliberately last. The value was written when the bristsurvey ran, much
-- earlier, and a confirmed day cannot be edited afterwards, so reading it here
-- reads the same number. Asserting it up there made it the first thing in the
-- suite that needs the leader_day trigger alive, which quietly stole the
-- target of the control that turns that trigger off.
-- ============================================================================
-- STEP 4b, and the reason this needed its own case. leaderA is on this day
-- automatically, and their row hangs on PASS5 -- whose planned figure is 8.00
-- because that is what the leader typed for the WORKERS. The leader's own day
-- is the envelope, 07:00 to 16:00, and the survey has to take it from the row
-- rather than from the pass underneath it. 9.00, not 8.00: the two differ on
-- purpose, so reading the wrong one cannot pass by coincidence.
select pg_temp.ok(
  (select t.confirmed_hours = 9.00
   from public.tilldelning t
   where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date  = app.stockholm_today() - 2
     and t.source     = 'ledare'
     and t.released_at is null),
  'BRIST.leader_hours_from_the_envelope',
  'a surveyed day gives the arbetsledare their own span, not the pass''s');

-- ============================================================================
-- PAUSING AND UNPAUSING AN ARBETSLEDARE -- Step 4b's other direction
--
-- Last in the suite, because pausing leaderA lets go of every future day they
-- lead and nothing after this should have to work around that.
-- ============================================================================

insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
values ('cccccccc-0000-0000-0000-00000000000f',
        'aaaaaaaa-0000-0000-0000-00000000000a', app.stockholm_today() + 50,
        '07:00', '16:00', 8.00, 1, (select v from fx where k = 'leaderA'));

insert into public.tilldelning (pass_id, worker_id, source, work_date)
values ('cccccccc-0000-0000-0000-00000000000f',
        (select id from wid where k = 'w3'), 'manuell', app.stockholm_today() + 50);

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date  = app.stockholm_today() + 50
     and t.source = 'ledare' and t.released_at is null) = 1,
  'PAUSE.leader_on_the_day_to_begin_with',
  'a worker taking the day puts the arbetsledare on it');

set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));
update public.account set active = false where id = (select v from fx where k = 'leaderA');
reset role;

select pg_temp.ok(
  (select released_reason = 'account_paused'
   from public.tilldelning t
   where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date  = app.stockholm_today() + 50
     and t.source = 'ledare'),
  'PAUSE.leader_row_says_what_happened',
  'the row records the pause, not a departure the workers never made');

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date  = app.stockholm_today() + 50
     and t.source = 'ledare' and t.released_at is null) = 0,
  'PAUSE.leader_off_the_day',
  'a paused arbetsledare is not on a shift that has not started');

-- The half that was missing. Nothing used to run in this direction at all.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));
update public.account set active = true where id = (select v from fx where k = 'leaderA');
reset role;

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date  = app.stockholm_today() + 50
     and t.source = 'ledare' and t.released_at is null) = 1,
  'PAUSE.unpause_puts_the_leader_back',
  'reactivating an arbetsledare puts them back on the days their people are on');

-- ============================================================================
-- STEP 5c -- Avboka Pass on an arbetsledare, and the three answers
--
-- Three past days, one per route, because the routes do different things to
-- the record and the difference is the whole point.
--
-- leaderB gets a worker record here. Until now they had none, which is what
-- STEP4B.no_worker_record_is_not_placed is about -- so this comes after it,
-- and after everything else, because taking leaders off days is not a thing
-- later assertions should have to work around.
-- ============================================================================

insert into public.worker (account_id, name, email)
select v, 'Leaderb', 'leaderb.worker@suite.test' from fx where k = 'leaderB'
on conflict do nothing;

-- Into the fixture lookup as well. Assertions below run as leaderA, and the
-- worker table's own policy lets a leader read exactly one row -- their own --
-- so reading leaderB's id from public.worker there returns NULL and fails an
-- assertion about something else entirely.
insert into wid (k, id)
select 'leaderB', w.id from public.worker w
where w.account_id = (select v from fx where k = 'leaderB');

insert into public.pass (id, project_id, work_date, start_time, end_time,
                         planned_hours, headcount, created_by)
select p.a, 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid, p.b, '07:00'::time, '16:00'::time,
       8.00::numeric, 1::smallint, (select v from fx where k = 'leaderA')
from (values
  ('cccccccc-0000-0000-0000-000000000010'::uuid, app.stockholm_today() - 4),  -- route 1
  ('cccccccc-0000-0000-0000-000000000011', app.stockholm_today() - 5),        -- route 2
  ('cccccccc-0000-0000-0000-000000000012', app.stockholm_today() - 6)         -- route 3
) as p(a, b);

-- A worker on each day is what puts leaderA on it (Step 4b).
insert into public.tilldelning (pass_id, worker_id, source, work_date, confirmed_hours)
values
  ('cccccccc-0000-0000-0000-000000000010', (select id from wid where k = 'w1'),
   'manuell', app.stockholm_today() - 4, 8.00),
  ('cccccccc-0000-0000-0000-000000000011', (select id from wid where k = 'w2'),
   'manuell', app.stockholm_today() - 5, 8.00),
  ('cccccccc-0000-0000-0000-000000000012', (select id from wid where k = 'w3'),
   'manuell', app.stockholm_today() - 6, 8.00);

-- The leader rows the routes act on. Hours set now, because confirming a day
-- may not leave anyone's unset and these days get confirmed below.
update public.tilldelning t set confirmed_hours = 9.00
where t.source = 'ledare' and t.released_at is null
  and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
  and t.work_date in (app.stockholm_today() - 4, app.stockholm_today() - 5,
                      app.stockholm_today() - 6);

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.source = 'ledare' and t.released_at is null
     and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date in (app.stockholm_today() - 4, app.stockholm_today() - 5,
                         app.stockholm_today() - 6)) = 3,
  'S5C.three_days_with_a_leader_on_them',
  'each day has its arbetsledare before anyone is taken off it');

-- ---- what the popup offers -------------------------------------------------
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));

select pg_temp.ok(
  (select (g->'leaders') @> jsonb_build_array(
            jsonb_build_object('worker_id', (select id from wid where k = 'leaderB')))
   from public.leader_replacement_options(
     (select t.id from public.tilldelning t
      where t.source = 'ledare' and t.released_at is null
        and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
        and t.work_date = app.stockholm_today() - 4)) g),
  'S5C.options_list_free_leaders',
  'an arbetsledare not working that day is offered as a replacement');

select pg_temp.ok(
  (select not ((g->'leaders') @> jsonb_build_array(
                 jsonb_build_object('worker_id', (select id from wid where k = 'leaderA'))))
      and (g->'roster') @> jsonb_build_array(
            jsonb_build_object('worker_id', (select id from wid where k = 'w1')))
   from public.leader_replacement_options(
     (select t.id from public.tilldelning t
      where t.source = 'ledare' and t.released_at is null
        and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
        and t.work_date = app.stockholm_today() - 4)) g),
  'S5C.options_exclude_the_one_leaving',
  'the leader being replaced is not their own replacement, and the roster is the shift');

-- ---- ROUTE 1: another arbetsledare takes the day ---------------------------
select public.replace_leader(
  (select t.id from public.tilldelning t
   where t.source = 'ledare' and t.released_at is null
     and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date = app.stockholm_today() - 4),
  (select id from wid where k = 'leaderB'));
reset role;

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.source = 'ledare' and t.released_at is null
     and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date = app.stockholm_today() - 4
     and t.worker_id = (select id from wid where k = 'leaderB')) = 1,
  'S5C.replacement_holds_the_day', 'the arbetsledare who was picked is on the day');

select pg_temp.ok(
  (select released_reason = 'removed_by_leader'
   from public.tilldelning t
   where t.source = 'ledare' and t.released_at is not null
     and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date = app.stockholm_today() - 4
     and t.worker_id = (select id from wid where k = 'leaderA')),
  'S5C.replaced_leader_stays_off',
  'a person decided this, so the next schedule edit does not put them back');

select pg_temp.ok(
  (select count(*) from public.notification n
   where n.kind = 'leader_replaced'
     and (n.payload->>'work_date')::date = app.stockholm_today() - 4) = 2,
  'S5C.both_notified', 'neither of them chose it, so neither has to find out by looking');

select pg_temp.ok(
  (select coalesce(bool_and(pd.flagged_as is null), true)
   from public.project_day pd
   where pd.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and pd.work_date = app.stockholm_today() - 4),
  'S5C.a_swap_is_not_a_flag',
  'somebody is answerable for the day, so nothing about it is flagged');

-- ---- ROUTE 2: a worker covers as ansvarig ----------------------------------
-- Admin only. A leader may swap like for like; deciding a day runs without an
-- arbetsledare is the owner's admission to make.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.rejects($$
  select public.leave_day_unsupervised(
    (select t.id from public.tilldelning t
     where t.source = 'ledare' and t.released_at is null
       and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
       and t.work_date = app.stockholm_today() - 5))
$$, 'S5C.leader_cannot_flag_a_day');

select pg_temp.act_as((select v from fx where k = 'admin'));

-- Somebody who was not on the shift cannot have been in charge of it.
select pg_temp.rejects($$
  select public.make_worker_ansvarig(
    (select t.id from public.tilldelning t
     where t.source = 'ledare' and t.released_at is null
       and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
       and t.work_date = app.stockholm_today() - 5),
    (select id from wid where k = 'w3'))
$$, 'S5C.ansvarig_must_be_on_the_shift');

select public.make_worker_ansvarig(
  (select t.id from public.tilldelning t
   where t.source = 'ledare' and t.released_at is null
     and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date = app.stockholm_today() - 5),
  (select id from wid where k = 'w2'));
reset role;

select pg_temp.ok(
  (select pd.flagged_as = 'worker_ansvarig'
      and pd.ansvarig_worker_id = (select id from wid where k = 'w2')
      and pd.confirmed_at is null
   from public.project_day pd
   where pd.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and pd.work_date = app.stockholm_today() - 5),
  'S5C.worker_ansvarig_flags_the_day',
  'the day is flagged, names who covered, and is not confirmed by doing so');

select pg_temp.ok(
  (select count(*) from public.notification n
   where n.kind = 'day_flagged'
     and n.account_id = (select v from fx where k = 'admin')
     and (n.payload->>'work_date')::date = app.stockholm_today() - 5) = 1,
  'S5C.admin_is_told', 'the admin hears about it without going to look');

-- INVARIANT 4b's last line. Not the project's other leaders, not the one who
-- was taken off, not anyone.
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'leaderA'));
select pg_temp.rejects($$
  update public.project_day
  set vad_vi_gjorde = 'Vi jobbade', confirmed_at = now(),
      confirmed_by = (select v from fx where k='leaderA'), confirmed_via = 'leader'
  where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
    and work_date = app.stockholm_today() - 5
$$, 'S5C.leader_cannot_confirm_a_flagged_day');

-- Nor may the admin call it something it was not.
select pg_temp.act_as((select v from fx where k = 'admin'));
select pg_temp.rejects($$
  update public.project_day
  set vad_vi_gjorde = 'Vi jobbade', confirmed_at = now(),
      confirmed_by = (select v from fx where k='admin'), confirmed_via = 'ingen_ledare'
  where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
    and work_date = app.stockholm_today() - 5
$$, 'S5C.wrong_flag_refused');

-- Confirming AND trying to wipe the flag in the same write. The guard freezes
-- how a day ran before it reads how it is being closed, so this succeeds with
-- the flag intact. Take the freeze away and the route check below catches it
-- instead -- the two are halves of one protection, which is why the control
-- for S5C.wrong_flag_refused covers both.
update public.project_day
set vad_vi_gjorde = 'W2 höll ihop dagen.', confirmed_at = now(),
    confirmed_by = (select v from fx where k='admin'), confirmed_via = 'worker_ansvarig',
    flagged_as = null, ansvarig_worker_id = null
where project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
  and work_date = app.stockholm_today() - 5;
reset role;

select pg_temp.ok(
  (select pd.stage = 'admin_confirmed' and pd.confirmed_via = 'worker_ansvarig'
      and pd.flagged_as = 'worker_ansvarig'
      and pd.ansvarig_worker_id = (select id from wid where k = 'w2')
   from public.project_day pd
   where pd.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and pd.work_date = app.stockholm_today() - 5),
  'S5C.flag_survives_confirmation',
  'confirming a day is not a way to forget how it ran');

-- ---- ROUTE 3: nobody ------------------------------------------------------
set local role authenticated;
select pg_temp.act_as((select v from fx where k = 'admin'));
select public.leave_day_unsupervised(
  (select t.id from public.tilldelning t
   where t.source = 'ledare' and t.released_at is null
     and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date = app.stockholm_today() - 6));
reset role;

select pg_temp.ok(
  (select pd.flagged_as = 'ingen_ledare' and pd.ansvarig_worker_id is null
   from public.project_day pd
   where pd.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and pd.work_date = app.stockholm_today() - 6),
  'S5C.unsupervised_is_its_own_admission',
  'a day nobody was answerable for is not the same record as a covered one');

select pg_temp.ok(
  (select count(*) from public.tilldelning t
   where t.source = 'ledare' and t.released_at is null
     and t.project_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     and t.work_date = app.stockholm_today() - 6) = 0,
  'S5C.nobody_is_on_the_day', 'and there is genuinely nobody on it');

select pg_temp.ok(true, 'SUITE.complete', 'every assertion passed');
