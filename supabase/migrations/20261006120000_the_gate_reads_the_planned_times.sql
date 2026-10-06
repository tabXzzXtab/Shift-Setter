-- ============================================================================
-- THE GATE READS THE PLANNED TIMES, AND BEKRÄFTA SAVES IN ONE TRANSACTION
--
-- Reproduced in testing: a pass planned to end 11:30; on the day the leader
-- corrects a worker's end to 12:30 on Bekräfta and presses Bekräfta dagen.
--   1. the browser wrote the new times to the pass,
--   2. then the hours to each tilldelning,
--   3. then the day -- and tg_confirmation_guard refused it: "not over yet",
--      because it measured the day's end with the time just written.
-- Steps 1 and 2 had already committed. The day then dropped out of the queue
-- (pendingDays() filtered on the same edited end) and the leader could not
-- reach it again until 12:30.
--
-- Two fixes, both needed:
--
-- 1. pass.start_time_original / end_time_original. What the pass was PLANNED
--    as. They follow edits while the shift has not started -- an admin moving
--    next Tuesday from 07-16 to 07-12 is rescheduling, and the day must become
--    confirmable at 12 -- and freeze the moment it starts, so a correction made
--    on or after the day can never move the gate. Nobody writes them directly.
--    The gate reads them; the overlap test and close_pass keep reading the
--    real times, because those are about hours actually worked.
--
-- 2. public.confirm_day(): Bekräfta's writes as ONE call. SECURITY INVOKER, so
--    every policy and trigger fires exactly as it did for the separate writes
--    -- this adds no privilege -- and a refusal anywhere rolls back all of it,
--    the time corrections included.
--
-- Owner decisions, 2026-10-06: store both originals; follow until start.
-- ============================================================================

alter table public.pass
  add column start_time_original time,
  add column end_time_original   time;

-- What every existing pass was planned as is no longer recorded anywhere, so
-- the best available value is the current one. A pass already corrected on
-- the day carries its correction as its "original"; nothing can recover more.
-- Only the new columns are written: pass_edit_guard returns early when the
-- times are untouched, and leader_day_pass fires only on start/end/deleted_at.
update public.pass
   set start_time_original = start_time,
       end_time_original   = end_time;

alter table public.pass
  alter column start_time_original set not null,
  alter column end_time_original   set not null;

comment on column public.pass.start_time_original is
  'The planned start: follows start_time until the shift starts, then frozen. Never written directly.';
comment on column public.pass.end_time_original is
  'The planned end: follows end_time until the shift starts, then frozen. The confirmation gate reads this.';

create or replace function app.tg_pass_original_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Whatever the caller sent, the plan is the times the pass was made with.
    new.start_time_original := new.start_time;
    new.end_time_original   := new.end_time;
    return new;
  end if;

  if new.start_time_original is distinct from old.start_time_original
     or new.end_time_original is distinct from old.end_time_original then
    raise exception 'the planned times of a pass are not written directly; they follow start_time and end_time until the shift starts'
      using errcode = 'insufficient_privilege';
  end if;

  -- Before the shift starts an edit is a reschedule, and the plan moves with
  -- it. From its start on, an edit is a correction of what happened, and the
  -- plan stays where it was.
  if now() < app.pass_start_at(old.work_date, old.start_time_original) then
    new.start_time_original := new.start_time;
    new.end_time_original   := new.end_time;
  end if;
  return new;
end $$;

create trigger pass_original_times
  before insert or update on public.pass
  for each row execute function app.tg_pass_original_times();

grant execute on function app.tg_pass_original_times() to authenticated;

CREATE OR REPLACE FUNCTION app.tg_confirmation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_last_end   timestamptz;
  v_missing    integer;
  v_claim_moved boolean;
begin
  if tg_op = 'DELETE' then
    if old.confirmed_at is not null then
      raise exception 'a confirmed day cannot be deleted'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  -- ==========================================================================
  -- STAGE 2 -- the day already carries a confirmation.
  -- ==========================================================================
  if tg_op = 'UPDATE' and old.confirmed_at is not null then

    -- INVARIANT 5, the second wall. Terminal means terminal.
    if old.stage = 'admin_confirmed' then
      raise exception 'day % on project % is admin_confirmed and final; nothing edits it',
        old.work_date, old.project_id using errcode = 'insufficient_privilege';
    end if;

    -- INVARIANT 5, the first wall. Stage 1 is final FOR THE LEADER: the only
    -- thing that puts the day back in their hands is the admin rejecting it.
    if not app.is_admin() then   -- stage 2 is the admin's alone
      raise exception 'day % is confirmed; stage 1 is final -- only the admin reviews it',
        old.work_date using errcode = 'insufficient_privilege';
    end if;

    -- How the day RAN is not something reviewing it can change.
    new.flagged_as         := old.flagged_as;
    new.ansvarig_worker_id := old.ansvarig_worker_id;

    -- REVIEWING A CLAIM IS NOT MAKING ONE. Whatever the outcome, the
    -- confirmation under review stays attributed to whoever made it.
    v_claim_moved := new.confirmed_at  is distinct from old.confirmed_at
                  or new.confirmed_by  is distinct from old.confirmed_by
                  or new.confirmed_via is distinct from old.confirmed_via;

    if v_claim_moved and new.stage is not null then
      raise exception 'stage 2 reviews a confirmation; it cannot rewrite whose it was'
        using errcode = 'insufficient_privilege';
    end if;

    if new.stage is null then
      -- ---- REJECT AND SEND BACK. The only route that reopens a day. --------
      if new.rejection_note is null or btrim(new.rejection_note) = '' then
        raise exception 'a rejected day needs a note saying what is wrong'
          using errcode = 'check_violation';
      end if;

      new.confirmed_at   := null;
      new.confirmed_by   := null;
      new.confirmed_via  := null;
      new.reviewed_at    := null;
      new.reviewed_by    := null;
      new.rejection_note := btrim(new.rejection_note);
      new.rejected_at    := now();
      new.rejected_by    := (select auth.uid());

      insert into public.day_review (project_id, work_date, action, note, acted_by)
      values (new.project_id, new.work_date, 'rejected', new.rejection_note,
              (select auth.uid()));

      return new;

    elsif new.stage = 'admin_confirmed' then
      -- ---- APPROVE, with or without the admin's corrections. ---------------
      if new.vad_vi_gjorde is null or btrim(new.vad_vi_gjorde) = '' then
        raise exception 'a day cannot be approved with no account of what was done'
          using errcode = 'check_violation';
      end if;

      select count(*) into v_missing
      from public.tilldelning t
      join public.pass p on p.id = t.pass_id
      where p.project_id = new.project_id and p.work_date = new.work_date
        and p.deleted_at is null and t.released_at is null
        and t.confirmed_hours is null;

      if v_missing > 0 then
        raise exception '% assignment(s) on % still have no confirmed hours',
          v_missing, new.work_date using errcode = 'check_violation';
      end if;

      new.rejected_at    := old.rejected_at;
      new.rejected_by    := old.rejected_by;
      new.rejection_note := old.rejection_note;
      new.reviewed_at    := now();
      new.reviewed_by    := (select auth.uid());

      insert into public.day_review (project_id, work_date, action, acted_by)
      values (new.project_id, new.work_date, 'approved', (select auth.uid()));

      return new;
    end if;

    -- ---- Neither. An edit that leaves the day where it is. -----------------
    new.stage          := old.stage;
    new.reviewed_at    := old.reviewed_at;
    new.reviewed_by    := old.reviewed_by;
    new.rejected_at    := old.rejected_at;
    new.rejected_by    := old.rejected_by;
    new.rejection_note := old.rejection_note;
    return new;
  end if;

  -- ==========================================================================
  -- STAGE 1 -- and the routes that reach admin_confirmed with no leader.
  -- ==========================================================================

  -- The review axis is stage 2's alone.
  if tg_op = 'INSERT' then
    new.reviewed_at := null; new.reviewed_by := null;
    new.rejected_at := null; new.rejected_by := null; new.rejection_note := null;
  else
    new.reviewed_at    := old.reviewed_at;
    new.reviewed_by    := old.reviewed_by;
    new.rejected_at    := old.rejected_at;
    new.rejected_by    := old.rejected_by;
    new.rejection_note := old.rejection_note;

    -- The flag may be SET while the day is open -- that write is Step 5c
    -- itself -- but the write that closes the day may not move it. Otherwise
    -- confirming a day would be a way to forget how it ran.
    if new.confirmed_at is not null then
      new.flagged_as         := old.flagged_as;
      new.ansvarig_worker_id := old.ansvarig_worker_id;
    end if;
  end if;

  -- Writing the "Vad Vi Gjorde" text is the leader's on their own projects, and
  -- the admin's when filling a bristsurvey. Confirming is narrower -- below.
  -- Or you are the arbetsledare STANDING on this project this day. After a
  -- swap (Step 5d) that is somebody with no standing membership at all, and
  -- refusing them here would refuse the only person who was there.
  -- Kept on ONE LINE deliberately: this is what a negative control has to
  -- find in the stored body, and a stored body carries whatever line
  -- endings the migration file had.
  if not (app.leads_project(new.project_id) or app.holds_the_day(new.project_id, new.work_date)) then
    raise exception 'not your project'
      using errcode = 'insufficient_privilege';
  end if;

  if new.confirmed_at is null then
    new.stage := null;
  else
    -- WHO CLOSED THE DAY, AND BY WHICH ROUTE.
    if new.confirmed_via = 'leader' then
      -- INVARIANT 4b, its last line. A day that ran with a worker covering, or
      -- with nobody, has no leader claim in it to make -- not by the project's
      -- other leaders, and not by the one who was taken off it.
      if new.flagged_as is not null then
        raise exception 'day % ran without an arbetsledare; admin and only admin confirms it',
          new.work_date using errcode = 'insufficient_privilege';
      end if;

      if not app.confirms_project(new.project_id, new.work_date) then
        raise exception 'only the arbetsledare who held day % on this project may confirm it; the admin fills gaps through the bristsurvey', new.work_date
          using errcode = 'insufficient_privilege';
      end if;
      new.stage := 'leader_confirmed';

    elsif new.confirmed_via = 'bristsurvey' then
      if not app.is_admin() then
        raise exception 'only an admin completes a bristsurvey'
          using errcode = 'insufficient_privilege';
      end if;
      new.stage := 'admin_confirmed';

    elsif new.confirmed_via in ('worker_ansvarig', 'ingen_ledare') then
      -- The same shape as the bristsurvey: no stage 1 behind it, so the day is
      -- written straight to admin_confirmed and never enters a review queue.
      if not app.is_admin() then
        raise exception 'a flagged day is confirmed by the admin and nobody else'
          using errcode = 'insufficient_privilege';
      end if;
      -- And only as what it actually was.
      if new.flagged_as is distinct from new.confirmed_via then
        raise exception 'day % is not flagged as %; it cannot be confirmed as one',
          new.work_date, new.confirmed_via using errcode = 'check_violation';
      end if;
      new.stage := 'admin_confirmed';

    elsif new.confirmed_via = 'snabb' then
      -- THE FOURTH ROUTE. The admin arranged the day themselves -- rang
      -- somebody that morning, put them on site, and is stating the hours
      -- they agreed. There is no leader claim behind it and there never will
      -- be, which is the same shape as the bristsurvey: straight to
      -- admin_confirmed, never into a review queue.
      --
      -- It is NOT a flag. A flagged day is one nobody was answerable for; a
      -- snabb day has whoever leads the project standing on it, and saying
      -- otherwise in the record would be the wrong admission.
      if not app.is_admin() then
        raise exception 'only an admin files a Snabb Pass day'
          using errcode = 'insufficient_privilege';
      end if;

      if new.flagged_as is not null then
        raise exception 'day % ran without an arbetsledare; it is confirmed as what it was, not as a Snabb Pass',
          new.work_date using errcode = 'insufficient_privilege';
      end if;

      new.stage := 'admin_confirmed';

    else
      raise exception 'a confirmed day must record how it was confirmed'
        using errcode = 'check_violation';
    end if;

    -- Step 8: confirmable the minute its last shift has ended.
    -- THE PLANNED END, NOT THE EDITED ONE (20261006120000). A leader who
    -- corrects a worker's end from 11:30 to 12:30 on Bekräfta is correcting
    -- the record of the day, not rescheduling it; measured against the edit,
    -- the day stopped being "over" the moment it was stated, and the leader
    -- was locked out of a day they had just finished accounting for.
    select max(app.pass_end_at(p.work_date, p.start_time_original, p.end_time_original)) into v_last_end
    from public.pass p
    where p.project_id = new.project_id and p.work_date = new.work_date
      and p.deleted_at is null;

    if v_last_end is null then
      raise exception 'no shifts on % for this project; nothing to confirm', new.work_date
        using errcode = 'check_violation';
    end if;

    -- Step 8: confirmable the minute its last shift has ended -- and the
    -- snabb route is the ONE exception, backwards only.
    --
    -- A Snabb Pass is booked after the fact by construction: somebody dropped
    -- out this morning, a replacement stood there, and the admin is recording
    -- it at eleven. Making them come back at four to file a day they already
    -- know the whole of is the waiting this route exists to remove.
    --
    -- FORWARDS IT STILL REFUSES, and that is not a detail. The Arbetsdagbok is
    -- a statement about work that was done; a day that has not happened has no
    -- hours to state, however confident anybody is about them. Today or
    -- earlier is a claim about the past. Tomorrow is a plan.
    if new.confirmed_via = 'snabb' then
      if new.work_date > app.stockholm_today() then
        raise exception 'day % has not happened yet; a Snabb Pass cannot file it in advance',
          new.work_date using errcode = 'check_violation';
      end if;
    elsif now() < v_last_end then
      raise exception 'day % is not over yet; its last shift ends %', new.work_date, v_last_end
        using errcode = 'check_violation';
    end if;

    -- Section 9: NULL means not confirmed, 0 means confirmed no-show.
    select count(*) into v_missing
    from public.tilldelning t
    join public.pass p on p.id = t.pass_id
    where p.project_id = new.project_id and p.work_date = new.work_date
      and p.deleted_at is null and t.released_at is null
      and t.confirmed_hours is null;

    if v_missing > 0 then
      raise exception '% assignment(s) on % still have no confirmed hours',
        v_missing, new.work_date using errcode = 'check_violation';
    end if;

    new.confirmed_by := (select auth.uid());

    update public.worker w
    set late_marks = w.late_marks + 1
    where w.id in (
      select t.worker_id from public.tilldelning t
      join public.pass p on p.id = t.pass_id
      where p.project_id = new.project_id and p.work_date = new.work_date
        and p.deleted_at is null and t.released_at is null and t.late
    );
  end if;

  return new;
end $function$;


-- ----------------------------------------------------------------------------
-- public.confirm_day -- Bekräfta dagen, all of it or none of it.
--
-- p_rows: [{ tilldelning_id, pass_id, start_time, end_time, hours, late,
--            move_times }]. move_times is the browser saying the leader changed
-- this worker's times; the pass is written only then. Each write is scoped to
-- the day named, so a payload cannot reach a pass or a row elsewhere, and a
-- write RLS filters to nothing is a refusal here rather than a silent no-op.
-- ----------------------------------------------------------------------------
create or replace function public.confirm_day(
  p_project       uuid,
  p_date          date,
  p_vad_vi_gjorde text,
  p_rows          jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
      tilldelning_id uuid, pass_id uuid, start_time time, end_time time,
      hours numeric, late boolean, move_times boolean)
  loop
    if coalesce(r.move_times, false) then
      update public.pass p
         set start_time = r.start_time, end_time = r.end_time
       where p.id = r.pass_id
         and p.project_id = p_project and p.work_date = p_date
         and p.deleted_at is null;
      if not found then
        raise exception 'that shift is not on this day, or not yours to correct'
          using errcode = 'insufficient_privilege';
      end if;
    end if;

    update public.tilldelning t
       set confirmed_hours = r.hours, late = coalesce(r.late, false)
     where t.id = r.tilldelning_id
       and t.project_id = p_project and t.work_date = p_date
       and t.released_at is null;
    if not found then
      raise exception 'that person is not on this day, or not yours to confirm'
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  -- The day, last: the guard that refuses it refuses everything above.
  /*day*/
  insert into public.project_day
    (project_id, work_date, vad_vi_gjorde, confirmed_at, confirmed_by, confirmed_via)
  values
    (p_project, p_date, btrim(p_vad_vi_gjorde), now(), auth.uid(), 'leader')
  on conflict (project_id, work_date) do update
    set vad_vi_gjorde = excluded.vad_vi_gjorde,
        confirmed_at  = excluded.confirmed_at,
        confirmed_by  = excluded.confirmed_by,
        confirmed_via = excluded.confirmed_via;
  /*end day*/
end $$;

revoke all on function public.confirm_day(uuid, date, text, jsonb) from public, anon;
grant execute on function public.confirm_day(uuid, date, text, jsonb) to authenticated;
