-- ============================================================================
-- THE BRISTSURVEY -- the admin's gap-filling path.
--
-- The admin cannot make a stage 1 confirmation. Only the assigned arbetsledare
-- can, and that is the pressure the whole system runs on. But a leader can
-- quit, go silent, or simply never get to it, and the Arbetsdagbok is a legal
-- obligation that cannot wait. So when the admin picks a range and something
-- in it is missing, he is stopped before generation and made to close the gaps
-- himself -- laboriously, by ringing round and asking, because it should have
-- been the leader's job.
--
-- Two things this migration adds, and one it deliberately does not.
--
--   ADDS  the stage axis, so a surveyed day can land where the spec says it
--         lands: admin_confirmed, never entering a stage 2 review queue.
--   ADDS  the survey itself: what is missing (a read), and closing one day (a
--         write that derives hours from the clock).
--   DOES NOT add the stage 2 review queue, or the flagged-day route. Neither
--         is in this release. The stage column is still correct today: every
--         confirmation that exists is one of the two routes below.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE STAGE AXIS
--
-- Route and stage answer different questions and neither can be read off the
-- other: confirmed_via says WHO made the claim and how, stage says how far
-- through review it is. They happen to be 1:1 in this release because only two
-- routes exist -- but when stage 2 is built, an admin's approval will move a
-- day from leader_confirmed to admin_confirmed without touching its route, and
-- that is exactly the change a single column could not represent.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'day_stage') then
    create type public.day_stage as enum ('leader_confirmed', 'admin_confirmed');
  end if;
end $$;

alter table public.project_day
  add column if not exists stage public.day_stage;

-- Backfill with the guard out of the way: every confirmation that exists today
-- came through a leader, and the guard would otherwise refuse to touch a
-- confirmed row (invariant 5, which is the point of it).
alter table public.project_day disable trigger confirmation_guard;
update public.project_day
  set stage = 'leader_confirmed'
  where confirmed_at is not null and stage is null;
alter table public.project_day enable trigger confirmation_guard;

alter table public.project_day
  drop constraint if exists project_day_stage_matches_confirmation;
alter table public.project_day
  add constraint project_day_stage_matches_confirmation
  check ((confirmed_at is null) = (stage is null));

-- ---------------------------------------------------------------------------
-- 2. THE GUARD SETS THE STAGE
--
-- Derived in the trigger, not accepted from the client, for the same reason
-- confirmed_by is: a browser that could name its own stage could claim an
-- admin's approval for a leader's confirmation.
-- ---------------------------------------------------------------------------
create or replace function app.tg_confirmation_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_last_end timestamptz;
  v_missing  integer;
begin
  if tg_op = 'DELETE' then
    if old.confirmed_at is not null then
      raise exception 'a confirmed day cannot be deleted'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.confirmed_at is not null then
    raise exception 'day % on project % is confirmed and final; no edits after',
      old.work_date, old.project_id using errcode = 'insufficient_privilege';
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
-- 3. WHAT IS MISSING -- the read the survey is built from.
--
-- The same source of truth the generation guard uses, asked a different
-- question: not "may this generate" but "what exactly is in the way". Working
-- it out in the browser instead would be a second opinion that could disagree
-- with the only one that matters.
--
-- SECURITY DEFINER because it reads project_leader and worker names across a
-- whole project. is_admin() below is what keeps that from being a leak, and
-- nobody it returns false for gets past the first statement.
-- ---------------------------------------------------------------------------
create or replace function public.bristsurvey_gaps(
  p_project uuid,
  p_from    date,
  p_to      date
) returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $fn$
declare
  v_project public.project;
  v_covered daterange := daterange(p_from, p_to + 1, '[)');
  v_missing text[] := '{}';
  v_leaders jsonb;
  v_days    jsonb;
  v_shifts  integer;
begin
  if not app.is_admin() then
    raise exception 'only an admin runs a bristsurvey'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_project from public.project p where p.id = p_project;
  if v_project.id is null or v_project.deleted_at is not null then
    raise exception 'no such project' using errcode = 'check_violation';
  end if;

  -- The four cover values, in the order the document prints them.
  if btrim(v_project.name) = ''               then v_missing := v_missing || 'name'; end if;
  if btrim(v_project.bestallare_bolag) = ''   then v_missing := v_missing || 'bestallare_bolag'; end if;
  if btrim(v_project.bestallare_address) = '' then v_missing := v_missing || 'bestallare_address'; end if;
  if btrim(v_project.bestallare_orgnr) = ''   then v_missing := v_missing || 'bestallare_orgnr'; end if;

  select count(*) into v_shifts
  from public.pass p
  where p.project_id = p_project and p.deleted_at is null and p.work_date <@ v_covered;

  -- Who owed the confirmation. Named on screen so the admin can chase them
  -- instead of taking the day off them, which is the better outcome.
  select coalesce(jsonb_agg(d.name order by d.name), '[]'::jsonb) into v_leaders
  from public.project_leader pl
  join public.account_directory d on d.id = pl.account_id
  -- A nameless row would render as "null" on the chase screen. Every
  -- arbetsledare is also a worker and so has a name; one without is a broken
  -- account, and showing nothing beats showing a placeholder for a person.
  where pl.project_id = p_project and coalesce(d.active, false) and d.name is not null;

  -- One entry per day that is in the way, with what was registered on it.
  select coalesce(jsonb_agg(s.x order by s.x->>'work_date'), '[]'::jsonb) into v_days
  from (
    select jsonb_build_object(
      'work_date',     g.work_date,
      'needs_confirm', pd.confirmed_at is null,
      'needs_text',    pd.vad_vi_gjorde is null or btrim(pd.vad_vi_gjorde) = '',
      'vad_vi_gjorde', pd.vad_vi_gjorde,
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'worker', w.name,
                 'tider',  case
                             when t.clock_in is not null and t.clock_out is not null
                             then to_char(t.clock_in  at time zone 'Europe/Stockholm', 'HH24:MI')
                               || '-'
                               || to_char(t.clock_out at time zone 'Europe/Stockholm', 'HH24:MI')
                             else to_char(p.start_time, 'HH24:MI')
                               || '-' || to_char(p.end_time, 'HH24:MI')
                           end,
                 'timmar', case
                             when t.clock_in is not null and t.clock_out is not null
                             then round(extract(epoch from (t.clock_out - t.clock_in)) / 3600.0, 2)
                             else p.planned_hours
                           end,
                 'stamplat', t.clock_in is not null and t.clock_out is not null
               ) order by w.name), '[]'::jsonb)
        from public.tilldelning t
        join public.pass p   on p.id = t.pass_id
        join public.worker w on w.id = t.worker_id
        where p.project_id = p_project and p.work_date = g.work_date
          and p.deleted_at is null and t.released_at is null
      )
    ) as x
    from (
      select distinct p.work_date
      from public.pass p
      where p.project_id = p_project and p.deleted_at is null and p.work_date <@ v_covered
    ) g
    left join public.project_day pd
      on pd.project_id = p_project and pd.work_date = g.work_date
    where pd.confirmed_at is null
       or pd.vad_vi_gjorde is null
       or btrim(pd.vad_vi_gjorde) = ''
  ) s;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id',                 v_project.id,
      'name',               v_project.name,
      'bestallare_bolag',   v_project.bestallare_bolag,
      'bestallare_address', v_project.bestallare_address,
      'bestallare_orgnr',   v_project.bestallare_orgnr,
      'missing',            to_jsonb(v_missing)
    ),
    'leaders',    v_leaders,
    'has_shifts', v_shifts > 0,
    'days',       v_days
  );
end $fn$;

-- ---------------------------------------------------------------------------
-- 4. CLOSING ONE DAY -- the write.
--
-- One day, one question, one answer. The admin types the account of the day
-- and nothing else; the figures come from what was registered.
--
-- THIS IS THE ONE PLACE HOURS DERIVE FROM A SPAN, and it is an explicit
-- exception to invariant 1 rather than an oversight. It can overstate a day by
-- the length of an unpaid lunch -- which is exactly what the warning in front
-- of this path names. The way to avoid paying it is to get the leader to
-- confirm. Nobody types these hours, here or anywhere: an admin who could type
-- them would be making a stage 1 claim by another name.
--
-- SECURITY INVOKER on purpose. The guards -- not this function -- are what
-- stop a leader calling it: the hours write passes (they lead the project),
-- then the confirmation raises 'only an admin completes a bristsurvey' and the
-- whole call rolls back. The is_admin() check below only makes the message say
-- which of the two it was.
-- ---------------------------------------------------------------------------
create or replace function public.complete_bristsurvey(
  p_project   uuid,
  p_work_date date,
  p_text      text
) returns void
  language plpgsql
  set search_path = ''
as $fn$
declare
  v_over numeric;
  v_who  text;
begin
  if not app.is_admin() then
    raise exception 'only an admin completes a bristsurvey'
      using errcode = 'insufficient_privilege';
  end if;

  if p_text is null or btrim(p_text) = '' then
    raise exception 'the day needs an account of what was done'
      using errcode = 'check_violation';
  end if;

  -- numeric(4,2) tops out at 99.99. A worker who never clocked out turns into
  -- a span of days, and silently storing 24 or clamping would be inventing a
  -- figure -- the one thing this path must not do. Say which day and who.
  select round(extract(epoch from (t.clock_out - t.clock_in)) / 3600.0, 2), w.name
    into v_over, v_who
  from public.tilldelning t
  join public.pass p   on p.id = t.pass_id
  join public.worker w on w.id = t.worker_id
  where p.project_id = p_project and p.work_date = p_work_date
    and p.deleted_at is null and t.released_at is null
    and t.confirmed_hours is null
    and t.clock_in is not null and t.clock_out is not null
    and extract(epoch from (t.clock_out - t.clock_in)) / 3600.0 > 99.99
  limit 1;

  if v_over is not null then
    raise exception 'the clock span for % on % is % hours; correct the stamps before surveying the day',
      v_who, p_work_date, round(v_over, 1) using errcode = 'check_violation';
  end if;

  -- Registered, not typed. Clock span where both ends exist, planned where not.
  -- Written before the day is closed: the assignment guard refuses every edit
  -- to a confirmed day, and it is right to.
  update public.tilldelning t
  set confirmed_hours = case
        when t.clock_in is not null and t.clock_out is not null
        then round(extract(epoch from (t.clock_out - t.clock_in)) / 3600.0, 2)
        else p.planned_hours
      end
  from public.pass p
  where p.id = t.pass_id
    and p.project_id = p_project and p.work_date = p_work_date
    and p.deleted_at is null and t.released_at is null
    and t.confirmed_hours is null;

  -- The day itself. confirmed_by, the stage and the late marks are the guard's.
  insert into public.project_day (project_id, work_date, vad_vi_gjorde,
                                  confirmed_at, confirmed_by, confirmed_via)
  values (p_project, p_work_date, btrim(p_text),
          now(), (select auth.uid()), 'bristsurvey')
  on conflict (project_id, work_date) do update
    set vad_vi_gjorde = btrim(p_text),
        confirmed_at  = now(),
        confirmed_by  = (select auth.uid()),
        confirmed_via = 'bristsurvey';
end $fn$;

grant execute on function public.bristsurvey_gaps(uuid, date, date) to authenticated;
grant execute on function public.complete_bristsurvey(uuid, date, text) to authenticated;
