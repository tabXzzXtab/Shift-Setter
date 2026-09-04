-- ============================================================================
-- STAGE 2 -- the admin reviews the claim the leader made.
--
-- Confirmation happens twice. The leader states what happened and the day
-- becomes leader_confirmed. The admin then reviews it: approve, edit and
-- approve, or reject it back to the leader. Approval is admin_confirmed.
--
-- REVIEWING A CLAIM IS NOT MAKING ONE. Everything below is shaped by that one
-- sentence: the admin may accept, correct or refuse a leader's confirmation,
-- and at no point may he author one. So confirmed_at / confirmed_by /
-- confirmed_via -- the claim -- are frozen the moment they are written, and
-- stage 2 cannot rewrite them. The approval is recorded on its own axis,
-- reviewed_at / reviewed_by, precisely so the two can never be confused.
--
-- Invariant 5 becomes two walls instead of one:
--
--   leader_confirmed  the leader cannot climb back over it. The admin can edit.
--   admin_confirmed   terminal. Nothing edits it, the admin included.
--
-- Rejection is the only thing that reopens a day, and it puts the day back in
-- the leader's queue with the admin's note attached to it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE REVIEW AXIS ON THE DAY
--
-- reviewed_*  the admin's approval. Null on a day that reached
--             admin_confirmed by another route -- the bristsurvey, and later
--             a flagged day -- because there was no claim to approve.
-- rejected_*  the LAST rejection, kept after the leader re-confirms rather
--             than cleared. The leader's queue flags a day whose confirmation
--             is gone but whose rejection is not; the historik reads the same
--             columns to say a day came back once.
-- ---------------------------------------------------------------------------
alter table public.project_day
  add column if not exists reviewed_at    timestamptz,
  add column if not exists reviewed_by    uuid references public.account (id),
  add column if not exists rejected_at    timestamptz,
  add column if not exists rejected_by    uuid references public.account (id),
  add column if not exists rejection_note text;

alter table public.project_day
  drop constraint if exists project_day_reviewed_fields_together;
alter table public.project_day
  add constraint project_day_reviewed_fields_together
  check ((reviewed_at is null) = (reviewed_by is null));

-- An approval that approved nothing is a contradiction: the only stage a
-- review can leave a day in is admin_confirmed.
alter table public.project_day
  drop constraint if exists project_day_reviewed_only_at_stage_two;
alter table public.project_day
  add constraint project_day_reviewed_only_at_stage_two
  check (reviewed_at is null or stage = 'admin_confirmed');

-- A rejection with no note is a day sent back with no reason, which is how a
-- leader re-confirms exactly what was wrong the first time.
alter table public.project_day
  drop constraint if exists project_day_rejection_fields_together;
alter table public.project_day
  add constraint project_day_rejection_fields_together
  check (
    (rejected_at is null and rejected_by is null and rejection_note is null)
    or (rejected_at is not null and rejected_by is not null
        and rejection_note is not null and btrim(rejection_note) <> '')
  );

-- ---------------------------------------------------------------------------
-- 2. BEKRAFTELSE HISTORIK -- the log
--
-- The columns above hold the CURRENT state of one day. They cannot hold a
-- history: a day rejected twice keeps only the second note, and the first
-- rejection -- the one that says this leader has now been sent back twice --
-- disappears. So every stage 2 act is also appended here, and nothing ever
-- rewrites a row.
--
-- Append-only by grant, not by policy: authenticated is given SELECT and
-- nothing else, and the confirmation guard -- SECURITY DEFINER, therefore the
-- table's owner -- is the only writer there is.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'review_action') then
    create type public.review_action as enum ('approved', 'rejected');
  end if;
end $$;

create table if not exists public.day_review (
  id         bigint generated always as identity primary key,
  project_id uuid not null,
  work_date  date not null,
  action     public.review_action not null,
  note       text,
  acted_by   uuid not null references public.account (id),
  acted_at   timestamptz not null default now(),

  foreign key (project_id, work_date)
    references public.project_day (project_id, work_date) on delete cascade,

  constraint rejection_carries_a_note check (
    action <> 'rejected' or (note is not null and btrim(note) <> '')
  )
);

create index if not exists day_review_day_idx
  on public.day_review (project_id, work_date, acted_at);

alter table public.day_review enable row level security;

drop policy if exists day_review_staff_select on public.day_review;
create policy day_review_staff_select on public.day_review
  for select to authenticated
  using (app.leads_project(project_id));

-- ---------------------------------------------------------------------------
-- 3. THE CONFIRMATION GUARD, NOW WITH TWO STAGES
-- ---------------------------------------------------------------------------
create or replace function app.tg_confirmation_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
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

    -- REVIEWING A CLAIM IS NOT MAKING ONE. Whatever the outcome, the
    -- confirmation under review stays attributed to whoever made it. The one
    -- move allowed on those three columns is withdrawing them altogether,
    -- which is the rejection below and is asked for by the stage, never here.
    v_claim_moved := new.confirmed_at  is distinct from old.confirmed_at
                  or new.confirmed_by  is distinct from old.confirmed_by
                  or new.confirmed_via is distinct from old.confirmed_via;

    if v_claim_moved and new.stage is not null then
      raise exception 'stage 2 reviews a confirmation; it cannot rewrite whose it was'
        using errcode = 'insufficient_privilege';
    end if;

    -- The stage the client asks for IS the outcome, and there are only three.
    -- It is a request, not a value: everything about who and when is stamped
    -- below, and the insert path still refuses to read new.stage at all.
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

      -- Section 9: NULL hours mean not confirmed, 0 means confirmed no-show.
      -- A figure the admin blanked while editing must not be frozen into a
      -- document as a zero.
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
    -- The admin correcting the text before he has decided is not an outcome,
    -- so nothing about the review moves and the day stays in his queue.
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

  -- The review axis is stage 2's alone. A leader re-confirming a day that was
  -- sent back cannot wipe the rejection off it, and nobody can forge an
  -- approval on the way in.
  if tg_op = 'INSERT' then
    new.reviewed_at := null; new.reviewed_by := null;
    new.rejected_at := null; new.rejected_by := null; new.rejection_note := null;
  else
    new.reviewed_at    := old.reviewed_at;
    new.reviewed_by    := old.reviewed_by;
    new.rejected_at    := old.rejected_at;
    new.rejected_by    := old.rejected_by;
    new.rejection_note := old.rejection_note;
  end if;

  -- Writing the "Vad Vi Gjorde" text is the leader's on their own projects, and
  -- the admin's when filling a bristsurvey. Confirming is narrower -- below.
  if not app.leads_project(new.project_id) then
    raise exception 'not your project'
      using errcode = 'insufficient_privilege';
  end if;

  if new.confirmed_at is null then
    new.stage := null;
  else
    -- WHO CLOSED THE DAY, AND BY WHICH ROUTE.
    --
    -- 'leader'      -- the assigned arbetsledare, and only them. is_admin()
    --                  does not satisfy this: letting the owner confirm as a
    --                  leader would remove the pressure the system runs on and
    --                  rubber-stamp days he was not present for.
    -- 'bristsurvey' -- the admin, reconstructing a day the leader never closed.
    --                  A surveyed day is a confirmed day and never returns to
    --                  the leader's queue, so the record has to say it was the
    --                  owner who took the shot.
    if new.confirmed_via = 'leader' then
      if not app.confirms_project(new.project_id) then
        raise exception 'only the arbetsledare assigned to this project may confirm its days; the admin fills gaps through the bristsurvey'
          using errcode = 'insufficient_privilege';
      end if;
      new.stage := 'leader_confirmed';
    elsif new.confirmed_via = 'bristsurvey' then
      if not app.is_admin() then
        raise exception 'only an admin completes a bristsurvey'
          using errcode = 'insufficient_privilege';
      end if;
      -- No stage 1 behind it: there was no leader claim to review, so the day
      -- is written straight to admin_confirmed and never enters the queue.
      new.stage := 'admin_confirmed';
    else
      raise exception 'a confirmed day must record how it was confirmed'
        using errcode = 'check_violation';
    end if;

    -- Step 8: confirmable the minute its last shift has ended -- by the clock,
    -- not at midnight and not the next morning.
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
    -- Confirming may not leave anyone's hours unset, or that NULL would later
    -- be read as a zero and put a false claim in a legal document.
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

    -- Cumulative and permanent. Never decremented, so removing the assignment
    -- afterwards cannot launder the demotion away.
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
end $fn$;

-- ---------------------------------------------------------------------------
-- 4. THE ASSIGNMENT GUARD -- the same two walls, on the figures
--
-- Stage 2 is "approve, EDIT and approve, or reject", so the hours on a
-- leader_confirmed day have to move for the admin and stay put for everyone
-- else. Once admin_confirmed they stay put for everyone.
-- ---------------------------------------------------------------------------
create or replace function app.tg_assignment_write_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
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
     and not app.leads_project(v_project) then
    raise exception 'only an arbetsledare assigned to this project may write hours or the late mark'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;

-- ---------------------------------------------------------------------------
-- 5. THE SAME TWO WALLS ON THE TIMES
--
-- PASS TIDER is a cell of the document as much as PASS TIMMAR is, and it lives
-- on the pass rather than on the assignment -- so without this the guard above
-- protects half a row. A leader who had confirmed could still move the times,
-- and an admin_confirmed day would never have been final at all.
-- ---------------------------------------------------------------------------
create or replace function app.tg_pass_edit_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_confirmed timestamptz;
  v_stage     public.day_stage;
begin
  if new.start_time is not distinct from old.start_time
     and new.end_time is not distinct from old.end_time
     and new.planned_hours is not distinct from old.planned_hours
     and new.work_date is not distinct from old.work_date
     and new.project_id is not distinct from old.project_id then
    return new;
  end if;

  select pd.confirmed_at, pd.stage into v_confirmed, v_stage
  from public.project_day pd
  where pd.project_id = old.project_id and pd.work_date = old.work_date;

  if v_stage = 'admin_confirmed' then
    raise exception 'day % is admin_confirmed and final; its times cannot move', old.work_date
      using errcode = 'insufficient_privilege';
  end if;

  if v_confirmed is not null and not app.is_admin() then
    raise exception 'day % is confirmed; stage 1 is final -- only the admin edits it', old.work_date
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $fn$;

drop trigger if exists pass_edit_guard on public.pass;
create trigger pass_edit_guard
  before update on public.pass
  for each row execute function app.tg_pass_edit_guard();

-- ---------------------------------------------------------------------------
-- 6. THE TWO OUTCOMES, ONE WRITE EACH
--
-- "Edit and approve" is one outcome in the spec, not two acts, so the edits
-- and the approval land in one transaction: an approval that committed while
-- the corrections behind it did not would put figures in the document that
-- nobody approved.
--
-- SECURITY INVOKER on purpose, like complete_bristsurvey. The guards above are
-- what stop a leader calling these; the is_admin() checks here only make the
-- message say which of the two it was.
-- ---------------------------------------------------------------------------
create or replace function public.approve_day(
  p_project   uuid,
  p_work_date date,
  p_text      text  default null,
  p_rows      jsonb default '[]'::jsonb
) returns void
  language plpgsql
  set search_path = ''
as $fn$
declare
  v_stage public.day_stage;
  r       jsonb;
begin
  if not app.is_admin() then
    raise exception 'only the admin reviews a confirmed day'
      using errcode = 'insufficient_privilege';
  end if;

  select pd.stage into v_stage
  from public.project_day pd
  where pd.project_id = p_project and pd.work_date = p_work_date;

  if v_stage is distinct from 'leader_confirmed' then
    raise exception 'only a day the arbetsledare has confirmed can be approved'
      using errcode = 'check_violation';
  end if;

  -- The corrections first, while the day is still open to them.
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if r ? 'hours' then
      update public.tilldelning t
      set confirmed_hours = (r->>'hours')::numeric
      from public.pass p
      where t.id = (r->>'tilldelning')::uuid
        and p.id = t.pass_id
        and p.project_id = p_project and p.work_date = p_work_date;
    end if;

    if (r ? 'start') and (r ? 'end') then
      update public.pass p
      set start_time = (r->>'start')::time, end_time = (r->>'end')::time
      where p.id = (r->>'pass')::uuid
        and p.project_id = p_project and p.work_date = p_work_date
        and p.deleted_at is null;
    end if;
  end loop;

  update public.project_day pd
  set vad_vi_gjorde = coalesce(nullif(btrim(p_text), ''), pd.vad_vi_gjorde),
      stage         = 'admin_confirmed'
  where pd.project_id = p_project and pd.work_date = p_work_date;
end $fn$;

create or replace function public.reject_day(
  p_project   uuid,
  p_work_date date,
  p_note      text
) returns void
  language plpgsql
  set search_path = ''
as $fn$
begin
  if not app.is_admin() then
    raise exception 'only the admin reviews a confirmed day'
      using errcode = 'insufficient_privilege';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'a rejected day needs a note saying what is wrong'
      using errcode = 'check_violation';
  end if;

  update public.project_day pd
  set stage          = null,
      rejection_note = btrim(p_note)
  where pd.project_id = p_project and pd.work_date = p_work_date
    and pd.stage = 'leader_confirmed';

  if not found then
    raise exception 'only a day the arbetsledare has confirmed can be sent back'
      using errcode = 'check_violation';
  end if;
end $fn$;

-- ---------------------------------------------------------------------------
-- 7. BEKRAFTELSE HISTORIK -- the read
--
-- One definition for both roles. A view rather than a query built in the
-- browser because "filed" depends on public.arbetsdagbok, which is admin-only:
-- a leader assembling this read himself would get a different answer to the
-- same question, and a log two people disagree about is not a log.
--
-- A day is in the historik once it is finished with -- approved at stage 2, or
-- consumed by a generated document, which takes a day whatever stage it had
-- reached. Two routes in, and a day can arrive by both.
--
-- Values are CURRENT, never the printed ones: a stage 2 edit after generation
-- shows here, while the PDF stays the snapshot it was.
-- ---------------------------------------------------------------------------
create or replace view public.day_history with (security_invoker = false) as
select
  pd.project_id,
  pr.name         as project_name,
  pd.work_date,
  pd.vad_vi_gjorde,
  pd.stage,
  pd.confirmed_via,
  pd.confirmed_at,
  coalesce(cw.name, ca.role::text) as confirmed_by_name,
  pd.reviewed_at,
  coalesce(rw.name, ra.role::text) as reviewed_by_name,
  pd.rejected_at,
  pd.rejection_note,
  exists (select 1 from public.arbetsdagbok a
          where a.project_id = pd.project_id and pd.work_date <@ a.covered) as filed
from public.project_day pd
join public.project pr on pr.id = pd.project_id and pr.deleted_at is null  -- INVARIANT 8
left join public.account ca on ca.id = pd.confirmed_by
left join public.worker  cw on cw.account_id = pd.confirmed_by and cw.deleted_at is null
left join public.account ra on ra.id = pd.reviewed_by
left join public.worker  rw on rw.account_id = pd.reviewed_by and rw.deleted_at is null
where pd.confirmed_at is not null
  and app.leads_project(pd.project_id)
  and (
    pd.stage = 'admin_confirmed'
    or exists (select 1 from public.arbetsdagbok a
               where a.project_id = pd.project_id and pd.work_date <@ a.covered)
  );

-- ---------------------------------------------------------------------------
-- 8. GRANTS
-- ---------------------------------------------------------------------------
grant execute on all functions in schema app to authenticated;

grant select on public.day_review to authenticated;
grant select on public.day_history to authenticated;

grant execute on function public.approve_day(uuid, date, text, jsonb) to authenticated;
grant execute on function public.reject_day(uuid, date, text) to authenticated;

revoke all on public.day_review from anon;
revoke all on public.day_history from anon;
