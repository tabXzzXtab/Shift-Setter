-- ============================================================================
-- NEW LEDARE MODEL: NO AUTO-PLACEMENT; SELF-CONFIRMER ON ENTRY.
--
-- OLD MODEL: when any worker was assigned to a project-day, the trigger
-- `leader_day` auto-placed ALL of that project's leaders on the day. The
-- leader did not need to work the shift — membership of the project was
-- enough to generate their row.
--
-- NEW MODEL:
--   1. The two auto-placement triggers (leader_day, leader_day_pass) are
--      removed. An arbetsledare is placed the same way a worker is — via the
--      admin's "Tilldela" button, via förval, via handplocka, or by accepting
--      an open pass.
--
--   2. SELF-CONFIRMER. The moment an arbetsledare's worker row is INSERTed,
--      and no confirmer already holds that project-day, a separate
--      source='ledare' row is automatically created for them. That row is the
--      confirmation authority; their worker row still occupies a slot.
--      If a confirmer already exists, the trigger is a no-op.
--
--   3. TRANSFER CONFIRMATION. The admin can move the source='ledare' row to
--      any worker who is on the same project-day. The new holder need not be
--      an arbetsledare — invariant 4b is about who confirms the day they
--      stood on, not about their role.
--
-- WHAT DOES NOT CHANGE:
--   • app.sync_leader_day() is kept: it is called by tg_account_unpause()
--     when an arbetssledare is re-activated after a pause.
--   • admin_assign_leader() is unchanged: the admin can still manually place
--     a specific arbetsledare on a day that has no confirmer.
--   • The source='ledare' unique index, headcount exemption, and all stage 1
--     / stage 2 confirmation RPCs are unchanged.
--   • Stage 2 (admin review) is unchanged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. DROP THE AUTO-PLACEMENT TRIGGERS AND THEIR FUNCTIONS
--
-- The triggers that called sync_leader_day on every worker INSERT/UPDATE are
-- the auto-placement mechanism. Removing them ends it.
-- ---------------------------------------------------------------------------
drop trigger if exists leader_day      on public.tilldelning;
drop trigger if exists leader_day_pass on public.pass;

drop function if exists app.tg_leader_day()      cascade;
drop function if exists app.tg_leader_day_pass() cascade;

-- ---------------------------------------------------------------------------
-- 2. UPDATE admin_release_leader TO REMOVE THE sync_leader_day CALL
--
-- The old version called sync_leader_day() after releasing the row, which
-- would auto-place another leader from the project. That is now gone: a
-- released confirmer stays released until the admin or the trigger replaces
-- them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_release_leader(p_tilldelning uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.tilldelning;
begin
  if not app.is_admin() then
    raise exception 'only an admin may use this route'
      using errcode = 'insufficient_privilege';
  end if;

  perform app.guard_tenant('tilldelning', p_tilldelning);

  select t.* into v_row
  from public.tilldelning t
  where t.id = p_tilldelning;

  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;

  if v_row.source <> 'ledare' then
    raise exception 'this route is for ledare rows only; use avboka_pass for workers'
      using errcode = 'check_violation';
  end if;

  if v_row.released_at is not null then
    return;
  end if;

  update public.tilldelning t
  set released_at     = now(),
      released_reason = 'removed_by_leader',
      released_by     = (select auth.uid())
  where t.id = p_tilldelning;
  -- No sync_leader_day() call: the confirmer is gone until the admin reassigns
  -- or a new arbetssledare is placed on the day and the self-confirmer fires.
end $function$;

comment on function public.admin_release_leader(uuid) is
  'Admin-only: remove the confirmer (source=''ledare'') row from a project-day '
  'without going through the replacement flow. The day has no confirmer until '
  'the admin reassigns via transfer_confirmation or admin_assign_leader, or '
  'until an arbetsledare is placed on the day and the self-confirmer trigger fires.';

-- ---------------------------------------------------------------------------
-- 3. SELF-CONFIRMER TRIGGER
--
-- Fires AFTER every worker INSERT into tilldelning.
-- Skips source='ledare' rows (the row it would create) to prevent recursion.
-- Skips non-arbetssledare workers.
-- Skips project-days that already have an active confirmer.
-- Creates a source='ledare' row for the arbetssledare, using the envelope
-- of all workers currently on that project-day.
-- ---------------------------------------------------------------------------
create or replace function app.tg_place_self_as_confirmer() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_pass  public.pass;
  v_start time;
  v_end   time;
begin
  -- Only fire for new worker rows, not for the ledare rows this trigger creates.
  if new.source = 'ledare' then
    return new;
  end if;

  -- Is this worker an active arbetsledare?
  if not exists (
    select 1
    from public.account a
    join public.worker  w on w.account_id = a.id and w.id = new.worker_id
    where a.role       = 'arbetsledare'
      and a.active
      and a.deleted_at is null
  ) then
    return new;
  end if;

  -- Is there already an active confirmer for this project-day?
  if exists (
    select 1
    from public.tilldelning t
    where t.project_id  = new.project_id
      and t.work_date   = new.work_date
      and t.source      = 'ledare'
      and t.released_at is null
      -- The row being inserted is already in the table (AFTER trigger), but it
      -- has source <> 'ledare', so this check will not see it -- correct.
  ) then
    return new;
  end if;

  -- Envelope: earliest start to latest end across all WORKER rows on this
  -- project-day that are now active, INCLUDING the new one (AFTER trigger).
  select min(p2.start_time), max(p2.end_time)
    into v_start, v_end
  from public.tilldelning t
  join public.pass p2 on p2.id = t.pass_id and p2.deleted_at is null
  where t.project_id  = new.project_id
    and t.work_date   = new.work_date
    and t.released_at is null
    and t.source     <> 'ledare';

  -- Fallback: use the pass's own times when no other rows exist yet.
  if v_start is null then
    select p.start_time, p.end_time into v_start, v_end
    from public.pass p where p.id = new.pass_id and p.deleted_at is null;
  end if;

  -- Create the confirmer row. 'on conflict do nothing' guards against the
  -- race where two assignments land in the same transaction.
  insert into public.tilldelning
    (pass_id, worker_id, source, work_date, project_id, own_start, own_end)
  values
    (new.pass_id, new.worker_id, 'ledare', new.work_date, new.project_id,
     v_start, v_end)
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists place_self_as_confirmer on public.tilldelning;
create trigger place_self_as_confirmer
  after insert on public.tilldelning
  for each row execute function app.tg_place_self_as_confirmer();

comment on function app.tg_place_self_as_confirmer() is
  'AFTER INSERT on tilldelning. When an arbetssledare is placed as a worker '
  'and no confirmer yet holds that project-day, creates a source=''ledare'' row '
  'for them. Their worker row still occupies a headcount slot; the ledare row '
  'is exempt. No-op if a confirmer already exists.';

-- ---------------------------------------------------------------------------
-- 4. transfer_confirmation -- admin moves the confirmer role to any worker
--
-- The admin picks any worker who is on the shift (has an active non-ledare
-- row on the same project-day) and that person becomes the new confirmer.
-- The previous confirmer's ledare row is released; a new one is created for
-- the target. The target need not be an arbetsledare — invariant 4b says the
-- person on the ledare row confirms the day, regardless of their role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_confirmation(p_pass uuid, p_to_worker uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pass  public.pass;
  v_start time;
  v_end   time;
begin
  if not app.is_admin() then
    raise exception 'only an admin may transfer the confirmer role'
      using errcode = 'insufficient_privilege';
  end if;

  perform app.guard_tenant('pass', p_pass);

  select p.* into v_pass
  from public.pass p
  where p.id = p_pass and p.deleted_at is null;

  if v_pass.id is null then
    raise exception 'no such pass' using errcode = 'check_violation';
  end if;

  -- Target must be on this project-day as a worker (not via a ledare row).
  if not exists (
    select 1
    from public.tilldelning t
    where t.worker_id  = p_to_worker
      and t.project_id = v_pass.project_id
      and t.work_date  = v_pass.work_date
      and t.released_at is null
      and t.source    <> 'ledare'
  ) then
    raise exception 'target worker is not on this project-day'
      using errcode = 'check_violation';
  end if;

  -- Release the current confirmer row (if any).
  update public.tilldelning t
  set released_at     = now(),
      released_reason = 'removed_by_leader',
      released_by     = (select auth.uid())
  where t.project_id  = v_pass.project_id
    and t.work_date   = v_pass.work_date
    and t.source      = 'ledare'
    and t.released_at is null;

  -- Envelope: min start to max end across all workers on this project-day.
  select coalesce(min(p2.start_time), v_pass.start_time),
         coalesce(max(p2.end_time),   v_pass.end_time)
    into v_start, v_end
  from public.tilldelning t
  join public.pass p2 on p2.id = t.pass_id and p2.deleted_at is null
  where t.project_id  = v_pass.project_id
    and t.work_date   = v_pass.work_date
    and t.released_at is null
    and t.source     <> 'ledare';

  -- Clear a stale tombstone if the target was previously removed as confirmer.
  update public.tilldelning t
  set released_at     = null,
      released_reason = null,
      released_by     = null,
      pass_id         = v_pass.id,
      own_start       = v_start,
      own_end         = v_end
  where t.worker_id       = p_to_worker
    and t.work_date       = v_pass.work_date
    and t.project_id      = v_pass.project_id
    and t.source          = 'ledare'
    and t.released_reason = 'removed_by_leader';

  if not found then
    insert into public.tilldelning
      (pass_id, worker_id, source, work_date, project_id, own_start, own_end)
    values
      (v_pass.id, p_to_worker, 'ledare', v_pass.work_date,
       v_pass.project_id, v_start, v_end)
    on conflict do nothing;
  end if;
end $function$;

comment on function public.transfer_confirmation(uuid, uuid) is
  'Admin-only: move the source=''ledare'' (confirmer) row to a different worker '
  'who is on the same project-day. The previous confirmer is released; the new '
  'one is placed. The target need not be an arbetsledare.';

-- Grant execute to authenticated so PostgREST can call it.
grant execute on function public.transfer_confirmation(uuid, uuid) to authenticated;
