-- ============================================================================
-- TWO HOLES IN STEP 5C, FOUND BY READING IT AGAINST THE SPEC.
--
-- F1 -- A REPLACEMENT LEADER WAS LOST WHEN THE DAY EMPTIED AND REFILLED, and
-- the day it left behind was neither led nor flagged. Reproduced: take a
-- project's leader off through route 1, put a non-member in their place, take
-- the last worker off the day, put a worker back. The replacement is gone, no
-- arbetsledare row exists, flagged_as is null -- and because 4b falls back to
-- membership when a day has no leader row, the leader who was taken OFF the
-- day could then make a stage 1 claim about it. Fixed by making the tombstone
-- symmetric: see app.sync_leader_day below.
--
-- F3 -- GÖR ARBETARE ANSVARIG WAS GATED ONLY IN THE INTERFACE. The popup
-- offers it when the replacement list is empty, which is right, but the
-- function took anyone's word for it.
--
-- Neither is a change of intent. Both are the spec already written down,
-- enforced where it counts.
-- ============================================================================

create or replace function app.sync_leader_day(p_project uuid, p_date date)
returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_start time;
  v_end   time;
  v_pass  uuid;
begin
  -- THE ENVELOPE -- earliest shift start to latest shift end, across every
  -- worker on this project that day. A leader who arrives before the first
  -- person and leaves after the last is the ordinary case.
  select min(p.start_time), max(p.end_time)
    into v_start, v_end
  from public.tilldelning t
  join public.pass p on p.id = t.pass_id and p.deleted_at is null
  where t.project_id  = p_project
    and t.work_date   = p_date
    and t.released_at is null
    and t.source <> 'ledare';

  if v_start is null then
    -- Nobody is on the day, so the reason for the row is gone. Released, not
    -- deleted: if the leader had already clocked in, that stamp is evidence
    -- and invariant 3 does not lose evidence because a schedule changed.
    update public.tilldelning t
    set released_at     = now(),
        released_reason = 'no_workers_left'
    where t.project_id  = p_project
      and t.work_date   = p_date
      and t.source      = 'ledare'
      and t.released_at is null;
    return;
  end if;

  -- The row hangs on the day's first pass. Which one is bookkeeping -- it
  -- occupies no slot there and reads its times from own_start/own_end.
  select p.id into v_pass
  from public.pass p
  where p.project_id = p_project
    and p.work_date  = p_date
    and p.deleted_at is null
  order by p.start_time, p.id
  limit 1;

  -- The envelope moves when workers are added, removed, or their times edited.
  update public.tilldelning t
  set own_start = v_start, own_end = v_end
  where t.project_id  = p_project
    and t.work_date   = p_date
    and t.source      = 'ledare'
    and t.released_at is null
    and (t.own_start is distinct from v_start or t.own_end is distinct from v_end);

  insert into public.tilldelning
    (pass_id, worker_id, source, work_date, project_id, own_start, own_end)
  select v_pass, w.id, 'ledare', p_date, p_project, v_start, v_end
  from public.project_leader pl
  join public.account a on a.id = pl.account_id and a.active
  -- An arbetsledare who never works shifts holds an account with no worker
  -- record (spec Section 3). There is nothing to place, and nothing is wrong.
  join public.worker  w on w.account_id = pl.account_id and w.deleted_at is null
  where pl.project_id = p_project
    and not exists (
      select 1 from public.tilldelning t
      where t.worker_id   = w.id
        and t.work_date   = p_date
        and t.project_id  = p_project
        and t.source      = 'ledare'
        and t.released_at is null
    )
    -- Taken off this day BY A PERSON. A later edit to the schedule must not
    -- quietly put them back on it.
    --
    -- Only a deliberate removal counts. A row released because the shift it
    -- hung on was deleted, or because the last worker left, is the basis
    -- disappearing rather than anyone deciding anything -- and the leader
    -- belongs back on the day the moment there is a day again.
    and not exists (
      select 1 from public.tilldelning t
      where t.worker_id       = w.id
        and t.work_date       = p_date
        and t.project_id      = p_project
        and t.source          = 'ledare'
        and t.released_at    is not null
        and t.released_reason = 'removed_by_leader'
    )
    -- Committed elsewhere that day. Invariant 2's exception is a leader on two
    -- PROJECTS, not a leader working a shift as a worker.
    and not exists (
      select 1 from public.tilldelning t
      where t.worker_id   = w.id
        and t.work_date   = p_date
        and t.released_at is null
        and t.source     <> 'ledare'
    );

  -- ---- THE OTHER HALF OF THE SAME MEMORY --------------------------------
  --
  -- The insert above draws only from project_leader, so it can never bring
  -- back a leader who was not a member of the project: a Step 5c replacement,
  -- or a leader swapped in by Step 5d. Both are placed by hand precisely
  -- BECAUSE they are not members.
  --
  -- When the day emptied, their row was released as 'no_workers_left' -- the
  -- basis disappearing, not a decision anyone made -- and nothing above would
  -- ever consider them again. The day came back led by nobody and flagged as
  -- nothing, which is the unattended day Step 5c exists to make deliberate,
  -- reached without anyone pressing anything. Worse, with no arbetsledare row
  -- on it, invariant 4b falls back to membership and the leader who was
  -- explicitly taken off the day could confirm it.
  --
  -- So the memory is symmetric. 'removed_by_leader' remembers that a person
  -- decided somebody should be off this day and keeps them off it;
  -- 'no_workers_left' remembers who was standing there and puts them back
  -- when there is a day to stand on again.
  insert into public.tilldelning
    (pass_id, worker_id, source, work_date, project_id, own_start, own_end)
  -- DISTINCT resolves an unknown literal before the insert's target type can,
  -- so the cast is explicit here where the plain insert above needs none.
  select distinct v_pass, r.worker_id, 'ledare'::public.assignment_source,
         p_date, p_project, v_start, v_end
  from public.tilldelning r
  join public.worker  w on w.id = r.worker_id and w.deleted_at is null
  join public.account a on a.id = w.account_id and a.active
  where r.project_id      = p_project
    and r.work_date       = p_date
    and r.source          = 'ledare'
    and r.released_reason = 'no_workers_left'
    -- Members are the insert above's business. Letting both reach one worker
    -- would race for the same unique index to no purpose.
    and not exists (
      select 1 from public.project_leader pl
      where pl.project_id = p_project and pl.account_id = w.account_id
    )
    -- Already back on the day.
    and not exists (
      select 1 from public.tilldelning t
      where t.worker_id   = w.id
        and t.work_date   = p_date
        and t.project_id  = p_project
        and t.source      = 'ledare'
        and t.released_at is null
    )
    -- Taken off it by a person since. That decision outranks this memory.
    and not exists (
      select 1 from public.tilldelning t
      where t.worker_id       = w.id
        and t.work_date       = p_date
        and t.project_id      = p_project
        and t.source          = 'ledare'
        and t.released_reason = 'removed_by_leader'
    )
    -- Committed elsewhere that day, exactly as above.
    and not exists (
      select 1 from public.tilldelning t
      where t.worker_id   = w.id
        and t.work_date   = p_date
        and t.released_at is null
        and t.source     <> 'ledare'
    );
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


  -- Gör Arbetare Ansvarig is the fallback for having nobody to hand the day
  -- to, and the spec offers it only when the replacement list is empty. That
  -- rule lived in the popup, which makes it decorative: the database is the
  -- only real boundary, and a worker covering a day an arbetsledare could
  -- have taken is a flagged day that did not have to be one.
  --
  -- The same set the popup lists, asked as a question.
  if exists (
    select 1
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
  ) then
    raise exception 'an arbetsledare is free that day; one of them takes it before a worker does'
      using errcode = 'check_violation';
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
