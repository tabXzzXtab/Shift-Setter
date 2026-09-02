-- ============================================================================
-- The vacancy cascade -- spec Section 4, Step 5b.
--
-- "The vacated slot reopens. Headcount does not drop." Removing a worker is not
-- a correction to the demand: the pass still needs the same number of people,
-- so the empty slot walks back down the same list it was filled from.
--
-- Within five days of the shift, it does NOT walk. Nobody is ready for a
-- last-minute change and the system should not pretend otherwise -- the leader
-- places someone by hand or uses a Snabb Pass.
--
-- To make that possible the tier walk moves into a per-pass function. It was
-- already per-pass inside fill_passes' loop; this just gives it a name so the
-- cascade can call the same code rather than a second copy of it.
-- ============================================================================

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
  where t.pass_id = r.id and t.released_at is null;

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

-- fill_passes is now a loop over the named per-pass walk. Same signature, so
-- nothing calling it has to change.
create or replace function public.fill_passes(p_batch uuid)
returns table (filled_pass uuid, for_date date, slots integer, filled integer, offered integer)
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_project uuid;
  r         record;
  v         record;
begin
  select b.project_id into v_project from public.pass_batch b where b.id = p_batch;
  if v_project is null then
    raise exception 'no such batch' using errcode = 'check_violation';
  end if;
  if not app.leads_project(v_project) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select p.id, p.work_date as wd, p.headcount
    from public.pass p
    where p.batch_id = p_batch and p.deleted_at is null
    order by p.work_date, p.start_time
  loop
    select * into v from app.fill_pass(r.id);

    filled_pass := r.id;
    for_date := r.wd;
    slots := r.headcount;
    filled := v.filled;
    offered := v.offered;
    return next;
  end loop;
end $fn$;

-- ============================================================================
-- release_assignment, with the cascade
--
-- Returns what happened, because "the slot reopened and went out to four
-- people" and "this is inside five days, place someone yourself" are different
-- situations and the leader has to be able to tell them apart.
-- ============================================================================
drop function if exists public.release_assignment(uuid, public.release_reason);

create or replace function public.release_assignment(
  p_tilldelning uuid,
  p_reason public.release_reason default 'removed_by_leader'
) returns table (reopened boolean, filled integer, offered integer)
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_row     public.tilldelning;
  v_pass    public.pass;
  v_project uuid;
  v         record;
begin
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;

  select p.* into v_pass from public.pass p where p.id = v_row.pass_id;
  v_project := v_pass.project_id;

  if not app.leads_project(v_project) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  update public.tilldelning t
  set released_at = now(), released_reason = p_reason, released_by = (select auth.uid())
  where t.id = p_tilldelning and t.released_at is null;

  -- Never re-offered to the person taken off. Snabb Pass is the way back.
  insert into public.pass_block (pass_id, worker_id) values (v_row.pass_id, v_row.worker_id)
  on conflict do nothing;

  -- Any open offer this person held on the pass goes with them.
  update public.pass_offer o
  set state = 'withdrawn', responded_at = now()
  where o.pass_id = v_row.pass_id and o.worker_id = v_row.worker_id and o.state = 'offered';

  -- More than five days out: the slot reopens and refills down the list
  -- normally. Inside five days: no auto-fill, by design.
  if app.pass_start_at(v_pass.work_date, v_pass.start_time) > now() + interval '5 days' then
    select * into v from app.fill_pass(v_row.pass_id);
    reopened := true;
    filled := v.filled;
    offered := v.offered;
  else
    reopened := false;
    filled := 0;
    offered := 0;
  end if;

  return next;
end $fn$;

grant execute on function public.release_assignment(uuid, public.release_reason) to authenticated;

-- ============================================================================
-- Shortfall across a whole batch
--
-- "If a batch's total slots exceed the workers who have pre-picked those days."
-- Capacity is per day and does not pool: a worker free on Monday cannot cover
-- Tuesday as well, so four pre-pickers across twelve days is not forty-eight.
-- ============================================================================
create or replace function public.batch_shortfall(p_dates date[], p_slots_per_day integer)
returns table (work_date date, available integer, slots integer, short integer)
  language sql stable security definer
  set search_path = ''
as $$
  select c.work_date,
         c.available,
         p_slots_per_day,
         greatest(p_slots_per_day - c.available, 0)
  from public.forval_coverage(p_dates) c
  order by c.work_date
$$;

grant execute on function public.batch_shortfall(date[], integer) to authenticated;
