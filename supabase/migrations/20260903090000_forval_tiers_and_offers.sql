-- ============================================================================
-- Förval, the priority tiers, and Acceptera Pass.
--
-- The walk down the tiers runs HERE, not in the leader's browser. Three
-- reasons, all of them spec Section 6: the browser is not a boundary, so a
-- client-side allocation could be replayed with different inputs; the pass row
-- must be locked while slots are counted or two batches racing would overfill
-- it; and "two workers racing for the last slot resolve to exactly one winner"
-- is stated as enforced in the database.
-- ============================================================================

-- ISO week, Monday-based. Pure date arithmetic -- no timezone reaches this, so
-- it is genuinely immutable. "Fewest shifts held that week" needs a week.
create or replace function app.week_start(d date) returns date
  language sql immutable
  set search_path = ''
as $$ select d - (extract(isodow from d)::int - 1) $$;

comment on function app.week_start(date) is
  'Monday of the ISO week containing d. Used by the Tier 2 ordering.';

-- ============================================================================
-- fill_passes -- Step 3 and Step 4 of the lifecycle
--
--   Step 3, the exclusion filter, runs BEFORE any tier: a worker who already
--   holds an assignment on that date is invisible for that date. Not rankable,
--   not offered, not a fallback -- even if hand-picked.
--
--   Tier 1  Handplockade med förval. Hand-picked AND they pre-picked the day.
--           Being hand-picked is a ranking modifier, not a grant: the förval is
--           the entry ticket, so a pick who never marked the day is not here.
--   Tier 2  Övriga förvalda. Fewest shifts that week ranks highest; each
--           lateness mark pushes one position down, cumulatively; ties random.
--   Tier 3  Acceptera Pass, reached only when the förval list is exhausted or
--           empty. Offered to everyone free that day.
--
-- Returns one row per pass so the interface can report what happened without
-- re-deriving it.
-- ============================================================================
-- The OUT parameter names deliberately avoid pass_id, work_date and headcount.
-- In plpgsql a `returns table` column shadows a real column of the same name
-- throughout the body, which made `on conflict (pass_id, worker_id)` ambiguous.
drop function if exists public.fill_passes(uuid);

create or replace function public.fill_passes(p_batch uuid)
returns table (filled_pass uuid, for_date date, slots integer, filled integer, offered integer)
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_project uuid;
  r         record;
  v_need    integer;
  v_worker  uuid;
  v_source  public.assignment_source;
  v_filled  integer;
  v_offered integer;
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
    order by p.work_date
  loop
    -- The same row lock the headcount guard takes. Held for this pass while its
    -- slots are counted and filled, so a concurrent fill cannot overshoot.
    perform 1 from public.pass p where p.id = r.id for update;

    select r.headcount - count(*) into v_need
    from public.tilldelning t
    where t.pass_id = r.id and t.released_at is null;

    v_filled := 0;

    for v_worker, v_source in
      with excluded as (
        -- INVARIANT 2. Nobody is ever on two projects the same day; the address
        -- and the directives have to be unambiguous.
        select t.worker_id from public.tilldelning t
        where t.work_date = r.wd and t.released_at is null
        union
        -- A deleted shift is never re-offered to the people removed from it.
        select b.worker_id from public.pass_block b where b.pass_id = r.id
      ),
      available as (
        select
          f.worker_id,
          exists (
            select 1 from public.pass_batch_handpick h
            where h.batch_id = p_batch and h.worker_id = f.worker_id
          ) as handpicked,
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
          -- "Each lateness mark pushes a worker one position down, cumulatively
          -- and permanently." Literally that: a position offset, not a sort key.
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
        v_filled := v_filled + 1;
        v_need := v_need - 1;
      exception when unique_violation or check_violation then
        -- Someone took that date, or the pass filled, between ranking and
        -- insert. The guards are the authority; skip and carry on.
        null;
      end;
    end loop;

    v_offered := 0;

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
        -- Marking a day can't-work is an explicit no. Offering it back would
        -- ask a question that has already been answered.
        and not exists (
          select 1 from public.forval f
          where f.worker_id = w.id and f.work_date = r.wd and not f.can_work
        )
      on conflict (pass_id, worker_id) do nothing;

      get diagnostics v_offered = row_count;
    end if;

    filled_pass := r.id;
    for_date := r.wd;
    slots := r.headcount;
    filled := v_filled;
    offered := v_offered;
    return next;
  end loop;
end $fn$;

grant execute on function public.fill_passes(uuid) to authenticated;

-- ============================================================================
-- Shortfall at creation
--
-- "If a batch's total slots exceed the workers who have pre-picked those days,
-- the leader is told before generating." Told, not blocked -- anything short of
-- coverage is worth knowing about while the schedule can still be changed.
--
-- Counts per day, because coverage is a per-day fact: four pre-pickers across
-- twelve days is not four times twelve.
-- ============================================================================
create or replace function public.forval_coverage(p_dates date[])
returns table (work_date date, available integer)
  language sql stable security definer
  set search_path = ''
as $$
  select d::date,
         (select count(*)::integer
          from public.forval f
          join public.worker w on w.id = f.worker_id and w.deleted_at is null
          where f.work_date = d::date
            and f.can_work
            and not exists (
              select 1 from public.tilldelning t
              where t.worker_id = f.worker_id and t.work_date = d::date and t.released_at is null
            ))
  from unnest(p_dates) as d
$$;

grant execute on function public.forval_coverage(date[]) to authenticated;

-- Tier 2 reads forval by date across all workers; Tier 3 reads assignments by
-- date. Both run once per pass in a batch, so they are worth an index.
create index if not exists forval_can_work_idx
  on public.forval (work_date) where can_work;

create index if not exists tilldelning_date_active_idx
  on public.tilldelning (work_date, worker_id) where released_at is null;
