-- ============================================================================
-- INVARIANT 2 BECOMES A NO-OVERLAP RULE.
--
-- It said: no worker holds two assignments on the same date, ever. It now
-- says: no worker holds two assignments whose HOURS OVERLAP. A product
-- decision, made deliberately -- an afternoon Snabb Pass after a morning shift
-- is a real thing the company does, and the old rule made it impossible to
-- record. What the invariant was always protecting is somebody being booked
-- into two places at once, and a date was only ever a coarse stand-in for that.
--
-- THE ARBETSLEDARE EXCEPTION IS UNCHANGED AND IS NOW LOAD-BEARING IN A NEW WAY.
-- A leader auto-assigned to two projects holds a day on each, and those two
-- envelopes overlap by construction -- 07:00-16:00 on both sites is the normal
-- case. A pure no-overlap rule would forbid exactly the thing invariant 2
-- explicitly permits, so ledare rows are exempt from this check entirely, the
-- same carve-out the old index carried.
--
-- WHAT DID NOT CHANGE: automatic placement is still one shift per person per
-- day. app.fill_pass's tier walk and avboka_pass's replacement list both carry
-- their own "not already working that date" filter and keep it. Only a manual,
-- admin-made Snabb Pass may put a second non-overlapping shift on a day. The
-- rule this migration relaxes is the floor, not the policy above it.
--
-- A TRIGGER, NOT AN EXCLUSION CONSTRAINT. The times are on public.pass, not on
-- the assignment, so there is no expression on this table for an EXCLUDE to
-- range over.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE OLD FLOOR
-- ---------------------------------------------------------------------------
drop index if exists public.tilldelning_one_per_worker_per_day;

-- ---------------------------------------------------------------------------
-- 2. THE NEW ONE
--
-- Spans are compared as real timestamps through app.pass_start_at/pass_end_at,
-- not as `time` values, because a 22:00-06:00 shift ends the NEXT day and
-- comparing the clock faces would say it ends before it starts. That is also
-- why the candidate set is work_date +/- 1: a night shift genuinely overlaps
-- the following morning, and a rule that only looked at one date would let
-- somebody be booked 22:00-06:00 and again 05:00-13:00.
--
-- Half-open intervals: a shift ending 12:00 and one starting 12:00 do not
-- overlap. Back-to-back is the case this whole change exists to allow.
-- ---------------------------------------------------------------------------
create or replace function app.tg_no_overlapping_assignment() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_start timestamptz;
  v_end   timestamptz;
  v_clash text;
begin
  -- A released row is history, not a booking.
  if new.released_at is not null then
    return new;
  end if;

  -- Invariant 2's standing exception, unchanged.
  if new.source = 'ledare' then
    return new;
  end if;

  select app.pass_start_at(p.work_date, p.start_time),
         app.pass_end_at(p.work_date, p.start_time, p.end_time)
    into v_start, v_end
  from public.pass p
  where p.id = new.pass_id and p.deleted_at is null;

  -- The pass is gone. There is nothing to be in two places for, and the row is
  -- about to be released by the delete guard anyway.
  if v_start is null then
    return new;
  end if;

  select pr.name || ' ' || to_char(p.start_time, 'HH24:MI')
                 || '-' || to_char(p.end_time, 'HH24:MI')
    into v_clash
  from public.tilldelning t
  join public.pass p    on p.id = t.pass_id and p.deleted_at is null
  join public.project pr on pr.id = p.project_id
  where t.worker_id   = new.worker_id
    and t.id is distinct from new.id
    and t.released_at is null
    and t.source     <> 'ledare'
    and t.work_date between new.work_date - 1 and new.work_date + 1
    and app.pass_start_at(p.work_date, p.start_time) < v_end
    and v_start < app.pass_end_at(p.work_date, p.start_time, p.end_time)
  limit 1;

  if v_clash is not null then
    -- unique_violation, the errcode the index used to raise, so that anything
    -- already reading for a double-booking keeps reading the same thing.
    raise exception 'that person already works % and the hours overlap', v_clash
      using errcode = 'unique_violation';
  end if;

  return new;
end $fn$;

drop trigger if exists no_overlapping_assignment on public.tilldelning;
create trigger no_overlapping_assignment
  before insert or update on public.tilldelning
  for each row execute function app.tg_no_overlapping_assignment();

-- ---------------------------------------------------------------------------
-- 3. SNABB PASS STOPS CLEARING THE DAY
--
-- Three reported bugs, one statement. The release had no time predicate, no
-- source predicate and no regard for whether the day it reached into was
-- closed:
--
--   * it released shifts that did not overlap at all -- an afternoon Snabb
--     Pass cancelled that morning's work;
--   * it released the worker's LEDARE row, taking an arbetsledare off the day
--     they were leading, which nobody asked for and nothing recorded;
--   * and when any of those rows sat on an admin_confirmed day, invariant 5
--     refused the write and the whole call died with "day X is admin_confirmed
--     and final; no edits after" -- the raw database error, shown to the admin.
--
-- It now replaces only what it actually collides with, never a ledare row, and
-- says plainly when it cannot.
-- ---------------------------------------------------------------------------
create or replace function public.create_snabb_pass(
  p_project uuid,
  p_worker  uuid,
  p_date    date,
  p_start   time,
  p_end     time,
  p_hours   numeric
) returns uuid
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_pass  uuid;
  v_name  text;
  v_stuck text;
begin
  if not app.is_admin() then
    raise exception 'only an admin creates a Snabb Pass' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.project p where p.id = p_project and p.deleted_at is null
  ) then
    raise exception 'no such project' using errcode = 'check_violation';
  end if;

  select w.name into v_name
  from public.worker w where w.id = p_worker and w.deleted_at is null;
  if v_name is null then
    raise exception 'no such worker' using errcode = 'check_violation';
  end if;

  -- ASKED BEFORE ANYTHING IS WRITTEN. A day that reached admin_confirmed is
  -- final under invariant 5, and that is not a rule Snabb Pass gets to bend --
  -- those hours are already in an Arbetsdagbok. Refusing in the admin's own
  -- language beats letting a trigger three levels down do it in the
  -- database's.
  select pr.name || ' ' || to_char(p.start_time, 'HH24:MI')
                 || '-' || to_char(p.end_time, 'HH24:MI')
    into v_stuck
  from public.tilldelning t
  join public.pass p       on p.id = t.pass_id and p.deleted_at is null
  join public.project pr   on pr.id = p.project_id
  join public.project_day pd on pd.project_id = p.project_id and pd.work_date = p.work_date
  where t.worker_id   = p_worker
    and t.released_at is null
    and t.source     <> 'ledare'
    and t.work_date between p_date - 1 and p_date + 1
    and pd.stage = 'admin_confirmed'
    and app.pass_start_at(p.work_date, p.start_time) < app.pass_end_at(p_date, p_start, p_end)
    and app.pass_start_at(p_date, p_start) < app.pass_end_at(p.work_date, p.start_time, p.end_time)
  limit 1;

  if v_stuck is not null then
    raise exception
      '% har ett pass som krockar (%) och den dagen är redan bekräftad och låst. Ändra tiderna eller välj en annan person.',
      v_name, v_stuck
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.pass (project_id, work_date, start_time, end_time,
                           planned_hours, headcount, created_by)
  values (p_project, p_date, p_start, p_end, p_hours, 1, (select auth.uid()))
  returning id into v_pass;

  -- ONLY WHAT IT COLLIDES WITH. A morning shift and an afternoon Snabb Pass
  -- are two things that happened, and the Arbetsdagbok has a row for each.
  update public.tilldelning t
  set released_at = now(), released_reason = 'replaced_by_snabb',
      released_by = (select auth.uid())
  from public.pass p
  where p.id = t.pass_id and p.deleted_at is null
    and t.worker_id   = p_worker
    and t.released_at is null
    and t.source     <> 'ledare'          -- never takes a leader off their day
    and t.work_date between p_date - 1 and p_date + 1
    and app.pass_start_at(p.work_date, p.start_time) < app.pass_end_at(p_date, p_start, p_end)
    and app.pass_start_at(p_date, p_start) < app.pass_end_at(p.work_date, p.start_time, p.end_time);

  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  values (v_pass, p_worker, 'snabb', p_date);

  return v_pass;
end $fn$;

grant execute on function public.create_snabb_pass(uuid, uuid, date, time, time, numeric)
  to authenticated;

comment on function app.tg_no_overlapping_assignment() is
  'Invariant 2: a worker may hold several assignments on one date, but never '
  'two whose hours overlap. Arbetsledare rows are exempt -- a leader placed on '
  'two projects the same day holds envelopes that overlap by construction.';
