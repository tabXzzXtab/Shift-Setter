-- ============================================================================
-- THE TIER WALK IS TENANT-AWARE.
--
-- app.fill_pass() read "from public.worker" with no tenant filter in all three
-- tiers, so it ranked and offered every worker in the database regardless of
-- which company the pass belonged to. One installation hid it; two do not.
--
-- FOUND BY A CLEANUP THAT COULD NOT COMPLETE. Removing a test account releases
-- its shift, the vacancy cascade refills the pass, and the refill offered that
-- pass to workers in the other tenant -- pass_offer_tenant_matches_worker
-- refused the row and the removal died halfway. Five accounts could not be
-- deleted at all, in any order, because the cascade always reached across.
--
-- TIER 3 WAS THE VISIBLE HALF. It writes pass_offer, which carries a composite
-- key against worker, so a cross-tenant offer fails loudly. TIERS 1 AND 2 ARE
-- THE OTHER HALF AND THEY ARE WORSE: they write tilldelning, which has a
-- composite key against its PASS but none against its WORKER, so placing one
-- company's worker on another company's shift would have been accepted without
-- a word. Both are fixed here; fixing only the one that shouted would have
-- left the one that does not.
--
-- This is the RPC half of M2 arriving early, for one function, because the
-- data could not be cleaned without it. The other 25 SECURITY DEFINER
-- functions are still tenant-blind and are still M2's.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.fill_pass(p_pass uuid)
 RETURNS TABLE(filled integer, offered integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r         record;
  v_batch   uuid;
  v_need    integer;
  v_worker  uuid;
  v_source  public.assignment_source;
begin
  -- p.tenant_id joins the record so the tiers below can compare against it.
  select p.id, p.work_date as wd, p.headcount, p.batch_id, p.tenant_id
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
      -- SAME TENANT ONLY. tilldelning has no composite key against worker,
      -- so a cross-tenant placement here would be accepted in silence --
      -- the dangerous half of this bug rather than the loud one.
      join public.worker w on w.id = f.worker_id and w.deleted_at is null
        and w.tenant_id = r.tenant_id
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
      -- SAME TENANT ONLY. Without this the last tier reads every worker in
      -- the database and offers one company's shift to another company's
      -- people. pass_offer_tenant_matches_worker refuses the row, so the
      -- symptom was a failing write rather than a leak -- but a refusal in
      -- the middle of a vacancy cascade is its own outage.
      and w.tenant_id = r.tenant_id
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
end $function$
;
