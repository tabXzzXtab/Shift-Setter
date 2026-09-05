-- ============================================================================
-- STEP 5c -- Avboka Pass on an arbetsledare.
--
-- A leader is never simply removed. Somebody has to be answerable for the day,
-- so taking one off forces the question of who takes their place, and there
-- are exactly three answers.
--
--   1. Another arbetsledare takes the day. Nothing else changes: the
--      replacement holds the day and stage 1 is theirs to make.
--   2. A worker covers as ansvarig. They were covering, not supervising, so
--      there is no stage 1 claim to be made and the day goes to the admin.
--   3. Nobody. The day runs unsupervised, which is the worst of the three and
--      is recorded as its own thing.
--
-- 2 AND 3 ARE BOTH FLAGGED AND BOTH ADMIN-ONLY, and they stay two values
-- rather than one because they are different admissions about how the day ran.
--
-- THE FLAG LIVES BESIDE confirmed_via, NOT IN IT. confirmed_via says how a day
-- was closed and is written at confirmation; the flag says how the day RAN and
-- is written the moment the leader comes off it -- days, possibly, before
-- anyone confirms anything. The leader's queue has to skip the day and the
-- admin's has to highlight it long before either column could be set. And if
-- the admin generates first, the bristsurvey closes the day and confirmed_via
-- reads 'bristsurvey' -- at which point the flag is the only thing left that
-- remembers nobody was in charge.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE FLAG
-- ---------------------------------------------------------------------------
alter table public.project_day
  add column if not exists flagged_as         public.confirmation_source,
  add column if not exists ansvarig_worker_id uuid references public.worker (id);

-- Only the two flagged routes are flags. 'leader' and 'bristsurvey' are ways a
-- day was closed, and a day is not flagged for having been confirmed.
alter table public.project_day
  drop constraint if exists project_day_flag_is_a_flagged_route;
alter table public.project_day
  add constraint project_day_flag_is_a_flagged_route
  check (flagged_as is null or flagged_as in ('worker_ansvarig', 'ingen_ledare'));

-- A named worker belongs to exactly one of the two, and the other one means
-- there was nobody to name.
alter table public.project_day
  drop constraint if exists project_day_ansvarig_only_when_covered;
alter table public.project_day
  add constraint project_day_ansvarig_only_when_covered
  check ((ansvarig_worker_id is not null) = (flagged_as = 'worker_ansvarig'));

create index if not exists project_day_flagged_idx
  on public.project_day (flagged_as, work_date) where flagged_as is not null;

-- ---------------------------------------------------------------------------
-- 2. THE CONFIRMATION GUARD LEARNS THE TWO NEW ROUTES
--
-- Everything else is unchanged from stage 2's version. What is added:
--
--   * the flag is frozen once written -- a confirming write cannot clear it,
--     and stage 2 cannot rewrite it, for the same reason stage 2 cannot
--     rewrite whose claim it was;
--   * a flagged day cannot be confirmed by a leader AT ALL. Invariant 4b's
--     last line: a flagged day is outside every leader's scope;
--   * 'worker_ansvarig' and 'ingen_ledare' confirm like the bristsurvey does
--     -- admin only, straight to admin_confirmed, no stage 1 behind them --
--     and only on a day actually flagged that way. Naming a route the day did
--     not run would be a different lie from confirming it too early.
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
  if not app.leads_project(new.project_id) then
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
end $fn$;

-- ---------------------------------------------------------------------------
-- 3. WHAT THE POPUP OFFERS
--
-- Asked of the database rather than assembled in the browser, because "which
-- arbetsledare is free that day" is the same question the placement asks and
-- two answers to it would eventually disagree.
-- ---------------------------------------------------------------------------
create or replace function public.leader_replacement_options(p_tilldelning uuid)
returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $fn$
declare
  v_row     public.tilldelning;
  v_project public.project;
  v_name    text;
  v_leaders jsonb;
  v_roster  jsonb;
begin
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null or v_row.source <> 'ledare' then
    raise exception 'that is not an arbetsledare''s day' using errcode = 'check_violation';
  end if;

  if not app.leads_project(v_row.project_id) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  select * into v_project from public.project p where p.id = v_row.project_id;
  select w.name into v_name from public.worker w where w.id = v_row.worker_id;

  -- Every arbetsledare not already working that day, whatever project they are
  -- on: a replacement comes from wherever one is free. Someone already on the
  -- day is not free, including on this very project -- both its leaders are
  -- placed automatically, so the other one is already here.
  select coalesce(jsonb_agg(jsonb_build_object('worker_id', c.id, 'name', c.name)
                            order by c.name), '[]'::jsonb)
    into v_leaders
  from (
    select w.id, w.name
    from public.account a
    join public.worker  w on w.account_id = a.id and w.deleted_at is null
    where a.role = 'arbetsledare'
      and a.active
      and w.id <> v_row.worker_id
      and not exists (
        select 1 from public.tilldelning t
        where t.worker_id = w.id and t.work_date = v_row.work_date
          and t.released_at is null
      )
  ) c;

  -- The people actually on the shift. Route 2 picks from these and nowhere
  -- else: somebody who was not there cannot have been in charge.
  select coalesce(jsonb_agg(distinct jsonb_build_object('worker_id', w.id, 'name', w.name)),
                  '[]'::jsonb)
    into v_roster
  from public.tilldelning t
  join public.worker w on w.id = t.worker_id and w.deleted_at is null
  where t.project_id  = v_row.project_id
    and t.work_date   = v_row.work_date
    and t.released_at is null
    and t.source <> 'ledare';

  return jsonb_build_object(
    'tilldelning',  v_row.id,
    'leader_name',  v_name,
    'project_id',   v_row.project_id,
    'project_name', v_project.name,
    'work_date',    v_row.work_date,
    'leaders',      v_leaders,
    'roster',       v_roster
  );
end $fn$;

-- ---------------------------------------------------------------------------
-- 4. TAKING THE LEADER OFF
--
-- Shared by all three routes. 'removed_by_leader' is the one release reason
-- app.sync_leader_day() treats as a tombstone, and that is exactly what is
-- wanted here: a person decided this, and the next edit to the schedule must
-- not quietly put them back on the day.
-- ---------------------------------------------------------------------------
create or replace function app.take_leader_off(p_tilldelning uuid)
returns public.tilldelning
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_row public.tilldelning;
begin
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;

  if v_row.id is null or v_row.source <> 'ledare' then
    raise exception 'that is not an arbetsledare''s day' using errcode = 'check_violation';
  end if;
  if v_row.released_at is not null then
    raise exception 'that arbetsledare is already off this day'
      using errcode = 'check_violation';
  end if;

  update public.tilldelning t
  set released_at = now(), released_reason = 'removed_by_leader',
      released_by = (select auth.uid())
  where t.id = p_tilldelning;

  return v_row;
end $fn$;

-- ---------------------------------------------------------------------------
-- 5. ROUTE 1 -- another arbetsledare takes the day
--
-- The day proceeds normally from here: stage 1 belongs to the replacement, and
-- nothing about the day is flagged, because somebody is answerable for it.
--
-- The row is inserted rather than left to app.sync_leader_day(), which only
-- ever places a project's OWN leaders. A replacement is whoever was free.
-- ---------------------------------------------------------------------------
create or replace function public.replace_leader(p_tilldelning uuid, p_worker uuid)
returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_row public.tilldelning;
begin
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;
  if not app.leads_project(v_row.project_id) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.tilldelning t
             where t.worker_id = p_worker and t.work_date = v_row.work_date
               and t.released_at is null) then
    raise exception 'that arbetsledare is already working that day'
      using errcode = 'check_violation';
  end if;

  v_row := app.take_leader_off(p_tilldelning);

  insert into public.tilldelning
    (pass_id, worker_id, source, work_date, project_id, own_start, own_end)
  values (v_row.pass_id, p_worker, 'ledare', v_row.work_date, v_row.project_id,
          v_row.own_start, v_row.own_end);

  -- Neither of them chose it, so neither should have to find out by looking.
  insert into public.notification (account_id, kind, payload)
  select w.account_id, 'leader_replaced',
         jsonb_build_object('project_id', v_row.project_id,
                            'work_date', v_row.work_date,
                            'taken_over', w.id = p_worker)
  from public.worker w
  where w.id in (v_row.worker_id, p_worker) and w.account_id is not null;
end $fn$;

-- ---------------------------------------------------------------------------
-- 6. ROUTES 2 AND 3 -- the day is flagged
--
-- Admin only, both of them. Route 1 is a like-for-like swap and anyone who can
-- take a leader off can make it; these two decide that a day will run without
-- anyone answerable for it and that only the owner may close it. That is an
-- admission about the company, and the spec puts it in the admin's hands.
-- ---------------------------------------------------------------------------
create or replace function app.flag_day(
  p_tilldelning uuid,
  p_flag        public.confirmation_source,
  p_worker      uuid
) returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_row public.tilldelning;
begin
  if not app.is_admin() then
    raise exception 'only an admin lets a day run without an arbetsledare'
      using errcode = 'insufficient_privilege';
  end if;

  v_row := app.take_leader_off(p_tilldelning);

  insert into public.project_day (project_id, work_date, flagged_as, ansvarig_worker_id)
  values (v_row.project_id, v_row.work_date, p_flag, p_worker)
  on conflict (project_id, work_date) do update
    set flagged_as = p_flag, ansvarig_worker_id = p_worker;

  -- Highlighted in the queue is not enough on its own: a day nobody was
  -- answerable for should reach the admin without them going to look.
  insert into public.notification (account_id, kind, payload)
  select a.id, 'day_flagged',
         jsonb_build_object('project_id', v_row.project_id,
                            'work_date', v_row.work_date,
                            'flagged_as', p_flag)
  from public.account a
  where a.role = 'admin' and a.active;
end $fn$;

create or replace function public.make_worker_ansvarig(p_tilldelning uuid, p_worker uuid)
returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_row public.tilldelning;
begin
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;

  -- Somebody who was not there cannot have been in charge.
  if not exists (
    select 1 from public.tilldelning t
    where t.worker_id   = p_worker
      and t.project_id  = v_row.project_id
      and t.work_date   = v_row.work_date
      and t.released_at is null
      and t.source     <> 'ledare'
  ) then
    raise exception 'that person is not on this shift'
      using errcode = 'check_violation';
  end if;

  perform app.flag_day(p_tilldelning, 'worker_ansvarig', p_worker);
end $fn$;

create or replace function public.leave_day_unsupervised(p_tilldelning uuid)
returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  perform app.flag_day(p_tilldelning, 'ingen_ledare', null);
end $fn$;

grant execute on function public.leader_replacement_options(uuid) to authenticated;
grant execute on function public.replace_leader(uuid, uuid) to authenticated;
grant execute on function public.make_worker_ansvarig(uuid, uuid) to authenticated;
grant execute on function public.leave_day_unsupervised(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. CONFIRMING A FLAGGED DAY
--
-- Not approve_day, and not because of plumbing. approve_day reviews a claim a
-- leader made: it insists on stage 'leader_confirmed' and records the admin's
-- sign-off on the review axis. A flagged day has no claim in it. Nobody stated
-- what happened, so there is nothing to approve, nothing to reject back to,
-- and reviewed_at stays null -- the admin is making the only account of the
-- day there will ever be.
--
-- The hours come with it because nobody typed them either: the leader who
-- would have is the one who is not there. Corrections and the confirmation are
-- one call for the same reason approve_day is -- a confirmation that committed
-- while the figures behind it did not would put numbers in the document that
-- nobody stood behind.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_flagged_day(
  p_project   uuid,
  p_work_date date,
  p_text      text,
  p_rows      jsonb default '[]'::jsonb
) returns void
  language plpgsql
  set search_path = ''
as $fn$
declare
  v_flag public.confirmation_source;
  r      jsonb;
begin
  if not app.is_admin() then
    raise exception 'a flagged day is confirmed by the admin and nobody else'
      using errcode = 'insufficient_privilege';
  end if;

  select pd.flagged_as into v_flag
  from public.project_day pd
  where pd.project_id = p_project and pd.work_date = p_work_date
    and pd.confirmed_at is null;

  if v_flag is null then
    raise exception 'that day is not waiting as a flagged day'
      using errcode = 'check_violation';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if r ? 'hours' then
      update public.tilldelning t
      set confirmed_hours = (r->>'hours')::numeric
      from public.pass p
      where t.id = (r->>'tilldelning')::uuid
        and p.id = t.pass_id
        and p.project_id = p_project and p.work_date = p_work_date;
    end if;
  end loop;

  -- confirmed_via is the flag itself, never something passed in: the day is
  -- closed as what it was, and the guard refuses any other pairing anyway.
  update public.project_day pd
  set vad_vi_gjorde = btrim(p_text),
      confirmed_at  = now(),
      confirmed_by  = (select auth.uid()),
      confirmed_via = v_flag
  where pd.project_id = p_project and pd.work_date = p_work_date;
end $fn$;

grant execute on function public.confirm_flagged_day(uuid, date, text, jsonb) to authenticated;
