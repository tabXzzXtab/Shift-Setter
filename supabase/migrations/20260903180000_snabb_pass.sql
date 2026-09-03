-- ============================================================================
-- Snabb Pass -- the escape hatch. Spec Section 4, Step 7.
--
-- "Bypasses the entire priority list. Requires only a name. For last-second
--  dropouts, verbal arrangements, covering a no-show. On paper it is an
--  ordinary shift -- it prints in the Arbetsdagbok exactly like any other row.
--  Only the way it enters the system differs. It still enters the confirmation
--  queue; Snabb Pass skips the picking, never the confirming."
--
-- Arbetsledare AND admin, on their own projects. Section 2 once listed it as
-- admin-only, which contradicted Step 7; Step 7 was right and the spec is
-- corrected in this commit.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The headcount guard does not apply to a Snabb Pass.
--
-- Everywhere else the headcount is the demand and overfilling it is a bug. Here
-- it is the point: covering a no-show on a full shift is exactly the case the
-- escape hatch exists for, and the leader has already decided. Nothing else
-- gets this -- Tier 3 accepts still race for the last slot under the same lock.
-- ---------------------------------------------------------------------------
create or replace function app.tg_headcount_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_headcount smallint;
  v_taken     integer;
begin
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
    and t.id is distinct from new.id;

  if v_taken >= v_headcount then
    raise exception 'pass % is full (% of % slots taken)', new.pass_id, v_taken, v_headcount
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;

-- ---------------------------------------------------------------------------
-- assign_snabb: put a named person on an EXISTING pass, priority list skipped.
--
-- Authorisation moves from is_admin() to leads_project(), so an arbetsledare
-- can cover their own site. The pass has to be read before the check, because
-- the project is what the permission is scoped to.
-- ---------------------------------------------------------------------------
create or replace function public.assign_snabb(p_pass uuid, p_worker uuid) returns uuid
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_pass public.pass;
  v_id   uuid;
begin
  select p.* into v_pass from public.pass p where p.id = p_pass and p.deleted_at is null;
  if v_pass.id is null then
    raise exception 'no such shift' using errcode = 'check_violation';
  end if;

  if not app.leads_project(v_pass.project_id) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  -- "If that person held an assignment elsewhere that day, the Snabb Pass wins
  -- and the earlier one is released." Both halves in one transaction, so
  -- INVARIANT 2 is never momentarily false.
  update public.tilldelning t
  set released_at = now(), released_reason = 'replaced_by_snabb', released_by = (select auth.uid())
  where t.worker_id = p_worker and t.work_date = v_pass.work_date and t.released_at is null;

  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  values (p_pass, p_worker, 'snabb', v_pass.work_date)
  returning id into v_id;

  return v_id;
end $fn$;

-- ---------------------------------------------------------------------------
-- create_snabb_pass: the whole escape hatch in one call.
--
-- A shift and the person on it, together, because a Snabb Pass that created a
-- shift and then failed to staff it would leave an empty pass nobody asked for.
-- No batch, so no hand-picks and nothing for fill_passes to walk: the priority
-- list is not consulted at all, which is the definition of this feature.
-- ---------------------------------------------------------------------------
create or replace function public.create_snabb_pass(
  p_project uuid,
  p_worker uuid,
  p_date date,
  p_start time,
  p_end time,
  p_hours numeric
) returns uuid
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_pass uuid;
begin
  if not app.leads_project(p_project) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.worker w where w.id = p_worker and w.deleted_at is null) then
    raise exception 'no such worker' using errcode = 'check_violation';
  end if;

  insert into public.pass (project_id, work_date, start_time, end_time,
                           planned_hours, headcount, created_by)
  values (p_project, p_date, p_start, p_end, p_hours, 1, (select auth.uid()))
  returning id into v_pass;

  -- The earlier assignment that day is released, then this one takes its place.
  update public.tilldelning t
  set released_at = now(), released_reason = 'replaced_by_snabb', released_by = (select auth.uid())
  where t.worker_id = p_worker and t.work_date = p_date and t.released_at is null;

  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  values (v_pass, p_worker, 'snabb', p_date);

  return v_pass;
end $fn$;

grant execute on function public.create_snabb_pass(uuid, uuid, date, time, time, numeric)
  to authenticated;
