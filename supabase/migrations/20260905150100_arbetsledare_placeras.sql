-- ============================================================================
-- STEP 4b -- the arbetsledare is placed automatically.
--
-- The priority list is for workers. A leader does not queue for their own
-- project: any day a worker holds a slot on a project, that project's
-- arbetsledare is assigned to that day, the moment the assignment exists. No
-- offer, no accept, no deny. If a project has two arbetsledare, both are
-- placed.
--
-- THE ROW EXISTS BECAUSE WORKERS ARE THERE. That sentence decides everything
-- below. It is why the row appears on the first worker's assignment and is
-- released when the last one comes off; why it never consumes headcount, since
-- it was never a slot the pass demanded; and why its times are not any one
-- pass's times but the envelope across every worker on that project that day.
--
-- INVARIANT 2's ONE EXCEPTION, implemented rather than weakened. A leader
-- running two projects that both have people on Tuesday is placed on both and
-- prints a row in each Arbetsdagbok. So the unique index that forbids a second
-- assignment stops applying to 'ledare' rows, and a second unique index takes
-- its place: one leader row per project per day. Nothing but this function
-- creates such a row, and it does not extend to arbetare.
--
-- A leader who already holds an ORDINARY assignment that date is skipped. The
-- exception covers a leader auto-assigned to two projects, not a leader who is
-- working a shift as a worker -- they cannot be in both places, and the day
-- they lead is then a day with no leader on it. That gap is real and Step 5c
-- is where it gets recorded.
--
-- HOURS ARE NOT WRITTEN HERE. The row carries the span; the figure is
-- prefilled from it on the confirmation screen and the leader accepts or
-- corrects it. A number a human must accept is not a derived number, so
-- invariant 1 stands.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WHERE THE ROW HANGS, AND WHAT TIMES IT CARRIES
--
-- project_id is denormalised for the same reason work_date already is: a
-- unique index cannot reach through pass_id to find the project, and "one
-- leader row per project per day" is an index, not a hope.
--
-- own_start / own_end carry the envelope. They are null on a worker's row,
-- which reads its times from the pass it occupies.
-- ---------------------------------------------------------------------------
alter table public.tilldelning
  add column if not exists project_id uuid references public.project (id),
  add column if not exists own_start  time,
  add column if not exists own_end    time;

-- Filling a column the row never had is not an edit to the day, but the write
-- guard cannot tell the difference: it refuses any UPDATE touching a confirmed
-- day, which is exactly its job. Backfilling a new column is the one case that
-- has to go under it, so it goes under it explicitly and briefly.
alter table public.tilldelning disable trigger assignment_write_guard;

update public.tilldelning t
set project_id = p.project_id
from public.pass p
where p.id = t.pass_id and t.project_id is null;

alter table public.tilldelning enable trigger assignment_write_guard;

alter table public.tilldelning alter column project_id set not null;

alter table public.tilldelning
  drop constraint if exists tilldelning_own_span_together;
alter table public.tilldelning
  add constraint tilldelning_own_span_together
  check ((own_start is null) = (own_end is null));

-- Only the auto-assignment carries its own span. A worker's row that grew one
-- would be a shift nobody can find on the calendar.
alter table public.tilldelning
  drop constraint if exists tilldelning_own_span_is_the_leaders;
alter table public.tilldelning
  add constraint tilldelning_own_span_is_the_leaders
  check (own_start is null or source = 'ledare');

-- The same trigger that keeps work_date in step now keeps project_id in step.
create or replace function app.tg_sync_work_date() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  select p.work_date, p.project_id
    into new.work_date, new.project_id
  from public.pass p
  where p.id = new.pass_id;

  if not found then
    raise exception 'pass % does not exist', new.pass_id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. INVARIANT 2, WITH ITS EXCEPTION
-- ---------------------------------------------------------------------------
drop index if exists public.tilldelning_one_per_worker_per_day;

-- Unchanged for everyone the invariant is about: one assignment per worker per
-- date, released rows freeing the day so a Snabb Pass can take over.
create unique index tilldelning_one_per_worker_per_day
  on public.tilldelning (worker_id, work_date)
  where released_at is null and source <> 'ledare';

-- The exception, bounded. A leader may hold a day on each project they run,
-- and never two on the same one.
drop index if exists public.tilldelning_one_leader_row_per_project_day;
create unique index tilldelning_one_leader_row_per_project_day
  on public.tilldelning (worker_id, work_date, project_id)
  where released_at is null and source = 'ledare';

-- ---------------------------------------------------------------------------
-- 3. THE GUARDS THAT MUST LET IT THROUGH
--
-- Headcount: the leader's row is not a slot. Counting it would push a real
-- worker off a pass that still needs three people.
--
-- Block: pass_block records who was taken off a shift so it is never re-offered
-- to them. The auto-assignment is not an offer, and the tombstone that governs
-- it is a released 'ledare' row, checked in sync_leader_day.
-- ---------------------------------------------------------------------------
create or replace function app.tg_headcount_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_headcount smallint;
  v_taken     integer;
begin
  -- STEP 4b: the leader's row never consumed a slot, so it never counts
  -- towards one either.
  if new.source = 'ledare' then
    return new;
  end if;

  -- Only when the row starts or resumes occupying a slot.
  if tg_op = 'UPDATE' and not (old.released_at is not null and new.released_at is null) then
    return new;
  end if;

  -- Snabb Pass bypasses the entire priority list, headcount included.
  if new.source = 'snabb' then
    return new;
  end if;

  select p.headcount into v_headcount
  from public.pass p where p.id = new.pass_id
  for update;

  select count(*) into v_taken
  from public.tilldelning t
  where t.pass_id = new.pass_id
    and t.released_at is null
    and t.source <> 'ledare'
    and t.id is distinct from new.id;

  if v_taken >= v_headcount then
    raise exception 'pass % is full (% of % slots taken)', new.pass_id, v_taken, v_headcount
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function app.tg_block_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if new.source not in ('snabb', 'ledare')
     and exists (select 1 from public.pass_block b
                 where b.pass_id = new.pass_id and b.worker_id = new.worker_id) then
    raise exception 'worker % was removed from pass % and is not re-offered it; use a Snabb Pass',
      new.worker_id, new.pass_id using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. THE PLACEMENT ITSELF
--
-- One function, called from both triggers, so there is a single answer to
-- "who is on this day and between what times" rather than two that can drift.
-- ---------------------------------------------------------------------------
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
end $fn$;

-- ---------------------------------------------------------------------------
-- 5. WHEN IT RUNS
--
-- A worker's row appearing or being released changes who is on the day. A
-- pass's times changing, or the pass going away, changes the envelope.
--
-- The source check is what stops the recursion: the rows this function writes
-- are 'ledare' rows, and a 'ledare' row never triggers another pass of it.
-- ---------------------------------------------------------------------------
create or replace function app.tg_leader_day() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_row public.tilldelning;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;

  if v_row.source <> 'ledare' then
    perform app.sync_leader_day(v_row.project_id, v_row.work_date);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;

drop trigger if exists leader_day on public.tilldelning;
create trigger leader_day
  after insert or update of released_at or delete on public.tilldelning
  for each row execute function app.tg_leader_day();

create or replace function app.tg_leader_day_pass() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  perform app.sync_leader_day(new.project_id, new.work_date);
  return new;
end $fn$;

drop trigger if exists leader_day_pass on public.pass;
create trigger leader_day_pass
  after update of start_time, end_time, deleted_at on public.pass
  for each row execute function app.tg_leader_day_pass();

-- ---------------------------------------------------------------------------
-- 6. WHAT THE LEADER SEES OF THEIR OWN DAY
--
-- Same screen as any worker, so the same view -- but reading the envelope
-- where the row carries one, not the times of whichever pass it hangs on.
-- ---------------------------------------------------------------------------
create or replace view public.my_shift with (security_invoker = false) as
select
  t.id,
  t.pass_id,
  p.project_id,
  pr.name          as project_name,
  pr.site_address,
  p.work_date,
  coalesce(t.own_start, p.start_time) as start_time,
  coalesce(t.own_end,   p.end_time)   as end_time,
  p.planned_hours,
  t.clock_in,
  t.clock_out,
  -- Shown only once filed. Anything else is a figure that can still move.
  case
    when exists (
      select 1 from public.arbetsdagbok a
      where a.project_id = p.project_id and p.work_date <@ a.covered
    )
    then t.confirmed_hours
  end as confirmed_hours,
  (pd.confirmed_at is not null) as day_confirmed,
  exists (
    select 1 from public.arbetsdagbok a
    where a.project_id = p.project_id and p.work_date <@ a.covered
  ) as filed
from public.tilldelning t
join public.pass p     on p.id = t.pass_id  and p.deleted_at is null
join public.project pr on pr.id = p.project_id and pr.deleted_at is null   -- INVARIANT 8
left join public.project_day pd
       on pd.project_id = p.project_id and pd.work_date = p.work_date
where t.released_at is null
  and t.worker_id = app.current_worker_id();

-- ---------------------------------------------------------------------------
-- 7. BACKFILL
--
-- Days that already have workers on them get their leaders, so the feature is
-- true of the schedule as it stands and not only of what is booked from now on.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select distinct t.project_id, t.work_date
    from public.tilldelning t
    join public.pass p on p.id = t.pass_id and p.deleted_at is null
    join public.project pr on pr.id = t.project_id and pr.deleted_at is null
    left join public.project_day pd
           on pd.project_id = t.project_id and pd.work_date = t.work_date
    where t.released_at is null
      and t.source <> 'ledare'
      -- A confirmed day is closed. Adding a row to it now would be a claim
      -- about hours nobody confirmed, on a day the guard forbids touching.
      and pd.confirmed_at is null
  loop
    perform app.sync_leader_day(r.project_id, r.work_date);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- avboka_pass refuses a leader's row.
--
-- The trash icon is gone from the interface for a 'ledare' row, but every
-- restriction that lives in the interface is decorative. Step 5c owns taking
-- a leader off a day, and until it exists the answer is no.
-- ---------------------------------------------------------------------------
create or replace function public.avboka_pass(p_tilldelning uuid)
returns jsonb
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_row     public.tilldelning;
  v_pass    public.pass;
  v_beyond  boolean;
  v_people  jsonb;
  v_offered integer := 0;
  v         record;
begin
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;

  select p.* into v_pass from public.pass p where p.id = v_row.pass_id;

  if not app.leads_project(v_pass.project_id) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  -- STEP 4b. A leader's row is not a slot and this is not the way off it.
  -- Taking an arbetsledare off a day forces the question of who is answerable
  -- for it, which is Step 5c's popup, not this one.
  if v_row.source = 'ledare' then
    raise exception 'an arbetsledare is not removed this way; a replacement must be chosen'
      using errcode = 'insufficient_privilege';
  end if;

  update public.tilldelning t
  set released_at = now(), released_reason = 'removed_by_leader', released_by = (select auth.uid())
  where t.id = p_tilldelning and t.released_at is null;

  -- Never re-offered to the person taken off. Snabb Pass is the way back.
  insert into public.pass_block (pass_id, worker_id)
  values (v_row.pass_id, v_row.worker_id)
  on conflict do nothing;

  update public.pass_offer o
  set state = 'withdrawn', responded_at = now()
  where o.pass_id = v_row.pass_id and o.worker_id = v_row.worker_id and o.state = 'offered';

  -- WHO IS FREE. Marked the day can-work, still employed, still able to sign
  -- in, not already working that date, and not someone taken off this very
  -- pass. The same filters the tier walk applies, asked as a question instead
  -- of acted on.
  select coalesce(jsonb_agg(jsonb_build_object('worker_id', c.id, 'name', c.name)
                            order by c.name), '[]'::jsonb)
    into v_people
  from (
    select w.id, w.name
    from public.forval f
    join public.worker w  on w.id = f.worker_id and w.deleted_at is null
    join public.account a on a.id = w.account_id and a.active
    where f.work_date = v_pass.work_date
      and f.can_work
      and not exists (
        select 1 from public.tilldelning t2
        where t2.worker_id = w.id and t2.work_date = v_pass.work_date
          and t2.released_at is null
      )
      and not exists (
        select 1 from public.pass_block b
        where b.pass_id = v_row.pass_id and b.worker_id = w.id
      )
  ) c;

  v_beyond := app.pass_start_at(v_pass.work_date, v_pass.start_time) > now() + interval '5 days';

  -- Cards only when there is nobody to ask. app.fill_pass is reused rather
  -- than reimplemented: with the candidate list empty its förval tiers find
  -- nobody by construction, so what it does here is exactly Tier 3.
  if v_people = '[]'::jsonb and v_beyond then
    select * into v from app.fill_pass(v_row.pass_id);
    v_offered := v.offered;
  end if;

  return jsonb_build_object(
    'pass_id',      v_row.pass_id,
    'work_date',    v_pass.work_date,
    'beyond_five_days', v_beyond,
    'offered',      v_offered,
    'replacements', v_people
  );
end $fn$;

-- ---------------------------------------------------------------------------
-- Deleting a pass must not blacklist the leader from the day.
-- ---------------------------------------------------------------------------
create or replace function app.tg_pass_delete_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'shifts are soft-deleted; set deleted_at instead'
      using errcode = 'insufficient_privilege';
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    if not app.is_admin() then
      raise exception 'only an admin may delete a shift'
        using errcode = 'insufficient_privilege';
    end if;

    if now() >= app.pass_start_at(old.work_date, old.start_time) then
      raise exception 'this shift has started and cannot be deleted; it must be confirmed'
        using errcode = 'check_violation';
    end if;

    if exists (select 1 from public.tilldelning t
               where t.pass_id = old.id and t.clock_in is not null) then
      raise exception 'someone has clocked in on this shift; it cannot be deleted'
        using errcode = 'check_violation';
    end if;

    new.deleted_by := (select auth.uid());

    -- The people on it are never re-offered it, and are told it is gone.
    insert into public.pass_block (pass_id, worker_id)
    select t.pass_id, t.worker_id from public.tilldelning t
    where t.pass_id = old.id and t.released_at is null
      -- STEP 4b: an auto-assigned leader was never OFFERED this pass, so
      -- there is nothing to block them from. Blocking them would also be a
      -- lie the next time the day has workers on it and needs them back.
      and t.source <> 'ledare'
    on conflict do nothing;

    insert into public.notification (account_id, kind, payload)
    select w.account_id, 'shift_deleted',
           jsonb_build_object('pass_id', old.id, 'work_date', old.work_date,
                              'project_id', old.project_id)
    from public.tilldelning t
    join public.worker w on w.id = t.worker_id
    where t.pass_id = old.id and t.released_at is null;

    update public.tilldelning t
    set released_at = now(), released_reason = 'shift_deleted', released_by = (select auth.uid())
    where t.pass_id = old.id and t.released_at is null;

    update public.pass_offer o
    set state = 'withdrawn', responded_at = now()
    where o.pass_id = old.id and o.state = 'offered';
  end if;

  return new;
end $fn$;

-- ---------------------------------------------------------------------------
-- Everywhere else a slot is counted.
--
-- The headcount trigger is not the only place that asks how full a pass is.
-- The tier walk asks to know how many it still has to find, and accepting a
-- card asks to know whether the queue should close. A 'ledare' row would
-- answer both wrongly, in the same direction: a pass that still needs people
-- looking as though it does not.
-- ---------------------------------------------------------------------------
create or replace function app.fill_pass(p_pass uuid)
returns table (filled integer, offered integer)
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  r         record;
  v_batch   uuid;
  v_need    integer;
  v_worker  uuid;
  v_source  public.assignment_source;
begin
  select p.id, p.work_date as wd, p.headcount, p.batch_id
    into r
  from public.pass p
  where p.id = p_pass and p.deleted_at is null
  -- The same row lock the headcount guard takes. Held while slots are counted
  -- and filled, so a concurrent fill or accept cannot overshoot.
  for update;

  if r.id is null then
    filled := 0; offered := 0; return next; return;
  end if;

  v_batch := r.batch_id;

  select r.headcount - count(*) into v_need
  from public.tilldelning t
  where t.pass_id = r.id and t.released_at is null
    -- STEP 4b: an auto-assigned arbetsledare occupies no slot, so counting
    -- their row here would tell the walk a full pass needs nobody.
    and t.source <> 'ledare';

  filled := 0;
  offered := 0;

  for v_worker, v_source in
    with excluded as (
      -- INVARIANT 2, and the exclusion filter of Step 3: already holding an
      -- assignment that date makes a worker invisible for it.
      select t.worker_id from public.tilldelning t
      where t.work_date = r.wd and t.released_at is null
      union
      -- A worker taken off this pass is never re-offered it.
      select b.worker_id from public.pass_block b where b.pass_id = r.id
    ),
    available as (
      select
        f.worker_id,
        -- Hand-picking is scoped to the batch the pass was generated in. A pass
        -- created outside a batch simply has no hand-picks.
        coalesce((
          select true from public.pass_batch_handpick h
          where h.batch_id = v_batch and h.worker_id = f.worker_id
        ), false) as handpicked,
        (
          select count(*)
          from public.tilldelning t2
          join public.pass p2 on p2.id = t2.pass_id and p2.deleted_at is null
          where t2.worker_id = f.worker_id
            and t2.released_at is null
            -- A shift counts whether or not it has been confirmed.
            and t2.work_date >= app.week_start(r.wd)
            and t2.work_date <  app.week_start(r.wd) + 7
        ) as shifts_this_week,
        w.late_marks
      from public.forval f
      join public.worker w on w.id = f.worker_id and w.deleted_at is null
      -- A paused account is not a candidate. Pausing means "no future shifts",
      -- and a shift they are offered tomorrow is a future shift.
      join public.account a on a.id = w.account_id and a.active
      where f.work_date = r.wd
        and f.can_work                        -- the entry ticket
        and f.worker_id not in (select worker_id from excluded)
    ),
    ranked as (
      select
        worker_id,
        handpicked,
        -- Tier 1 is ordered the same way as Tier 2 (spec Section 8): fewest
        -- shifts that week first, each lateness mark pushing one position down,
        -- cumulatively and permanently. A position offset, not a sort key.
        row_number() over (partition by handpicked order by shifts_this_week, random())
          + late_marks as rank_in_tier
      from available
    )
    select
      worker_id,
      case when handpicked then 'handplockad' else 'forval' end::public.assignment_source
    from ranked
    order by handpicked desc, rank_in_tier, random()
    limit greatest(v_need, 0)
  loop
    begin
      insert into public.tilldelning (pass_id, worker_id, source, work_date)
      values (r.id, v_worker, v_source, r.wd);
      filled := filled + 1;
      v_need := v_need - 1;
    exception when unique_violation or check_violation then
      -- Someone took that date, or the pass filled, between ranking and insert.
      -- The guards are the authority; skip and carry on.
      null;
    end;
  end loop;

  -- TIER 3, only once the förval list is exhausted or empty.
  if v_need > 0 then
    insert into public.pass_offer (pass_id, worker_id)
    select r.id, w.id
    from public.worker w
    where w.deleted_at is null
      and exists (
        select 1 from public.account a where a.id = w.account_id and a.active
      )
      and not exists (
        select 1 from public.tilldelning t
        where t.worker_id = w.id and t.work_date = r.wd and t.released_at is null
      )
      and not exists (
        select 1 from public.pass_block b where b.pass_id = r.id and b.worker_id = w.id
      )
      -- Marking a day can't-work is an answer. Offering it back asks a question
      -- that has already been answered. (Spec Section 4, Tier 3.)
      and not exists (
        select 1 from public.forval f
        where f.worker_id = w.id and f.work_date = r.wd and not f.can_work
      )
    on conflict (pass_id, worker_id) do nothing;

    get diagnostics offered = row_count;
  end if;

  return next;
end $fn$;

create or replace function public.accept_offer(p_pass uuid) returns uuid
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_worker uuid := app.current_worker_id();
  v_id     uuid;
begin
  if v_worker is null then
    raise exception 'no worker record for this account' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.pass_offer o
                 where o.pass_id = p_pass and o.worker_id = v_worker and o.state = 'offered') then
    raise exception 'this shift is not offered to you' using errcode = 'insufficient_privilege';
  end if;

  -- INVARIANT 2 is the partial unique index; this is the friendly message.
  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  values (p_pass, v_worker, 'oppen', (select p.work_date from public.pass p where p.id = p_pass))
  returning id into v_id;

  update public.pass_offer o set state = 'accepted', responded_at = now()
  where o.pass_id = p_pass and o.worker_id = v_worker;

  -- The pass vanishes from everyone else's queue once headcount is met.
  update public.pass_offer o set state = 'withdrawn', responded_at = now()
  where o.pass_id = p_pass and o.state = 'offered'
    and (select count(*) from public.tilldelning t
         where t.pass_id = p_pass and t.released_at is null
           and t.source <> 'ledare')
        >= (select p.headcount from public.pass p where p.id = p_pass);

  return v_id;
end $fn$;
