-- ============================================================================
-- INVARIANT 4b, CORRECTED: THE DAY IS THE SCOPE, NOT THE PROJECT.
--
-- Until now app.confirms_project() asked one question -- are you in
-- project_leader for this project -- and asked it about the project as a whole.
-- That was wrong in both directions the moment two leaders could trade a day
-- (Step 5d):
--
--   * THE LEADER WHO SWAPPED OUT could still confirm. They kept their standing
--     membership, so they could make a stage 1 claim about a day somebody else
--     stood on. That is the rubber-stamp the two-stage design exists to
--     prevent, one level below the admin.
--
--   * THE LEADER WHO SWAPPED IN could not. They held the day and the hours and
--     were the only person who could honestly say what happened on it, and the
--     system had no way for them to say it.
--
-- THE RULE NOW: if the day has an arbetsledare on it, the person on it
-- confirms it -- membership neither grants that nor is needed for it. If the
-- day has no arbetsledare row at all, membership is all there is to go on and
-- the old check stands unchanged. That second branch is what keeps the
-- bristsurvey and flagged days working: neither has a leader behind it, and
-- neither reaches this test anyway (both are admin routes), but a day whose
-- leaders were all busy elsewhere does, and it must stay confirmable.
--
-- Membership is now the FALLBACK, not the gate. A day-scoped rule that still
-- required membership would have refused the swapped-in leader -- which is
-- half the bug, and the half that leaves a real day permanently unconfirmable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WHO IS STANDING THERE
--
-- Not "who runs this site" -- who is on it, on this date. A ledare row is the
-- record of that, whether it was placed by Step 4b, handed over by Step 5c, or
-- traded by Step 5d.
--
-- SECURITY DEFINER and owned by the table owner, so it is not itself subject
-- to the tilldelning policies it is about to appear in. No table here has
-- FORCE ROW LEVEL SECURITY, so this does not recurse.
-- ---------------------------------------------------------------------------
create or replace function app.holds_the_day(p_project uuid, p_work_date date)
returns boolean
  language sql stable security definer
  set search_path = ''
as $fn$
  select exists (
    select 1
    from public.tilldelning t
    join public.worker w on w.id = t.worker_id and w.deleted_at is null
    where t.project_id  = p_project
      and t.work_date   = p_work_date
      and t.source      = 'ledare'
      and t.released_at is null
      and w.account_id  = (select auth.uid())
  )
$fn$;

-- Day-less, and only ever for READING the project row itself. A leader lent a
-- single day still needs the project's name to see which day they are
-- confirming; they are not thereby given the site.
create or replace function app.holds_a_day(p_project uuid)
returns boolean
  language sql stable security definer
  set search_path = ''
as $fn$
  select exists (
    select 1
    from public.tilldelning t
    join public.worker w on w.id = t.worker_id and w.deleted_at is null
    where t.project_id  = p_project
      and t.source      = 'ledare'
      and t.released_at is null
      and w.account_id  = (select auth.uid())
  )
$fn$;

-- ---------------------------------------------------------------------------
-- 2. WHO MAY MAKE THE STAGE 1 CLAIM
--
-- Still deliberately WITHOUT a fallback to app.is_admin(). That has not
-- changed and must not: the admin cannot make a stage 1 confirmation, and
-- narrowing the leader test is no reason to widen the admin one.
--
-- The signature takes a date now, because the rule is about a day. A function
-- that cannot see the day cannot enforce a per-day scope, and invariant 4b
-- always said "a per-row scope, not a role check".
-- ---------------------------------------------------------------------------
drop function if exists app.confirms_project(uuid);

create or replace function app.confirms_project(p_project uuid, p_work_date date)
returns boolean
  language sql stable security definer
  set search_path = ''
as $fn$
  select case
    when exists (
      select 1 from public.tilldelning t
      where t.project_id  = p_project
        and t.work_date   = p_work_date
        and t.source      = 'ledare'
        and t.released_at is null
    )
    -- Somebody was on the day. Then it is theirs to account for, and nobody
    -- else's -- not the project's other leaders, and not whoever used to hold
    -- it before a swap.
    then app.holds_the_day(p_project, p_work_date)
    -- Nobody was placed. Every leader of the project was committed elsewhere,
    -- or the project has none with a worker record. There is no row to point
    -- at, so membership is the only claim available and stays sufficient.
    else exists (
      select 1 from public.project_leader pl
      where pl.project_id = p_project
        and pl.account_id = (select auth.uid())
    )
  end
$fn$;

grant execute on function app.holds_the_day(uuid, date) to authenticated;
grant execute on function app.holds_a_day(uuid) to authenticated;
grant execute on function app.confirms_project(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. REACHING THE DAY AT ALL
--
-- Every one of these gates ran through app.leads_project(), which is
-- membership or admin and has no date in it. Left alone, the swapped-in leader
-- would be refused long before app.confirms_project() got a chance to allow
-- them: their Bekräfta Pass queue reads public.pass, and pass_leader_select
-- would hide the project entirely.
--
-- Each addition is the same one and is scoped to the single date the person
-- actually holds. They can read that day's shifts and write that day's hours.
-- They cannot edit the shifts (pass_leader_update is untouched), cannot create
-- shifts there, and see nothing about the project on any other date.
-- ---------------------------------------------------------------------------
drop policy if exists pass_leader_select on public.pass;
create policy pass_leader_select on public.pass for select
  using (
    deleted_at is null
    and (app.leads_project(project_id) or app.holds_the_day(project_id, work_date))
  );

drop policy if exists project_day_leader on public.project_day;
create policy project_day_leader on public.project_day for all
  using (
    app.leads_project(project_id) or app.holds_the_day(project_id, work_date)
  )
  with check (
    app.leads_project(project_id) or app.holds_the_day(project_id, work_date)
  );

drop policy if exists tilldelning_leader_select on public.tilldelning;
create policy tilldelning_leader_select on public.tilldelning for select
  using (
    exists (
      select 1 from public.pass p
      where p.id = tilldelning.pass_id
        and (app.leads_project(p.project_id)
             or app.holds_the_day(p.project_id, tilldelning.work_date))
    )
  );

drop policy if exists tilldelning_leader_write on public.tilldelning;
create policy tilldelning_leader_write on public.tilldelning for all
  using (
    exists (
      select 1 from public.pass p
      where p.id = tilldelning.pass_id
        and (app.leads_project(p.project_id)
             or app.holds_the_day(p.project_id, tilldelning.work_date))
    )
  )
  with check (
    exists (
      select 1 from public.pass p
      where p.id = tilldelning.pass_id
        and (app.leads_project(p.project_id)
             or app.holds_the_day(p.project_id, tilldelning.work_date))
    )
  );

-- Read-only, and the day-less test is the right one here: the project row
-- carries no date, and what is needed from it is the name.
drop policy if exists project_staff_select on public.project;
create policy project_staff_select on public.project for select
  using (
    deleted_at is null and (app.leads_project(id) or app.holds_a_day(id))
  );

-- ---------------------------------------------------------------------------
-- 4. THE GUARD
--
-- Two changes, both above: the "not your project" gate now also admits the
-- person standing on the day, and the stage 1 test passes the date. Everything
-- else is the live definition, unchanged.
-- ---------------------------------------------------------------------------
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

    else
      raise exception 'a confirmed day must record how it was confirmed'
        using errcode = 'check_violation';
    end if;

    -- Step 8: confirmable the minute its last shift has ended.
    select max(app.pass_end_at(p.work_date, p.start_time, p.end_time)) into v_last_end
    from public.pass p
    where p.project_id = new.project_id and p.work_date = new.work_date
      and p.deleted_at is null;

    if v_last_end is null then
      raise exception 'no shifts on % for this project; nothing to confirm', new.work_date
        using errcode = 'check_violation';
    end if;

    if now() < v_last_end then
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

-- ---------------------------------------------------------------------------
-- 5. AND THE HOURS THEMSELVES
--
-- Being allowed to confirm a day is worth nothing without being allowed to
-- fill in what it holds. Invariant 4's guard scoped hours to
-- app.leads_project() too, so the swapped-in leader could have closed a day
-- whose numbers they were forbidden to type.
--
-- WIDENED, NOT TIGHTENED, and the asymmetry is deliberate. The leader who
-- swapped out keeps write access to the hours until somebody confirms -- hours
-- are a working figure that a day's leaders correct between them, and
-- invariant 5 freezes them at stage 1 anyway. What they lost is the right to
-- CLOSE the day, which is the claim, and that is the thing that had to be
-- theirs alone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tg_assignment_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project   uuid;
  v_confirmed timestamptz;
  v_stage     public.day_stage;
  v_row       public.tilldelning;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;

  select p.project_id, pd.confirmed_at, pd.stage
    into v_project, v_confirmed, v_stage
  from public.pass p
  left join public.project_day pd
    on pd.project_id = p.project_id and pd.work_date = p.work_date
  where p.id = v_row.pass_id;

  -- INVARIANT 5, the second wall. The day is finished; nothing moves again.
  if v_stage = 'admin_confirmed' then
    raise exception 'day % is admin_confirmed and final; no edits after', v_row.work_date
      using errcode = 'insufficient_privilege';
  end if;

  -- INVARIANT 5, the first wall. The leader stated what happened and cannot
  -- restate it; the admin may correct it at stage 2 before approving.
  if v_confirmed is not null and not app.is_admin() then
    raise exception 'day % is confirmed; stage 1 is final -- only the admin edits it', v_row.work_date
      using errcode = 'insufficient_privilege';
  end if;

  -- INVARIANT 4 + 4b. Hours and the late mark are the leader's alone.
  if tg_op = 'UPDATE'
     and (new.confirmed_hours is distinct from old.confirmed_hours
          or new.late is distinct from old.late)
     and not (app.leads_project(v_project)
              or app.holds_the_day(v_project, v_row.work_date)) then
    raise exception 'only an arbetsledare on this project that day may write hours or the late mark'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $function$;
