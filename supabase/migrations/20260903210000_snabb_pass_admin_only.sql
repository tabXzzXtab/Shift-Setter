-- ============================================================================
-- Snabb Pass is ADMIN ONLY.
--
-- The previous migration widened it to arbetsledare, on the strength of Step 7
-- saying "Arbetsledare and admin only" against Section 2's admin-exclusive
-- list. Section 2 was the right one, and the spec is corrected accordingly in
-- this commit.
--
-- The reasoning that settles it: creating a Snabb Pass is inseparable from
-- putting someone on a shift who may not be on the roster at all, and adding
-- them creates an ACCOUNT. That power is the admin's. Splitting it -- a leader
-- who may Snabb Pass but only from the roster -- is a half-permission that
-- neither the spec nor the interface can explain to the person holding it.
--
-- The create-account Edge Function is unchanged. It was admin-only throughout;
-- that is what refused the leader and raised the question in the first place.
-- ============================================================================

create or replace function public.assign_snabb(p_pass uuid, p_worker uuid) returns uuid
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_pass public.pass;
  v_id   uuid;
begin
  if not app.is_admin() then
    raise exception 'only an admin creates a Snabb Pass' using errcode = 'insufficient_privilege';
  end if;

  select p.* into v_pass from public.pass p where p.id = p_pass and p.deleted_at is null;
  if v_pass.id is null then
    raise exception 'no such shift' using errcode = 'check_violation';
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
  if not app.is_admin() then
    raise exception 'only an admin creates a Snabb Pass' using errcode = 'insufficient_privilege';
  end if;

  -- Admin leads every project as far as app.leads_project() is concerned, but
  -- the project still has to exist and not be in the bin.
  if not exists (
    select 1 from public.project p where p.id = p_project and p.deleted_at is null
  ) then
    raise exception 'no such project' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.worker w where w.id = p_worker and w.deleted_at is null) then
    raise exception 'no such worker' using errcode = 'check_violation';
  end if;

  insert into public.pass (project_id, work_date, start_time, end_time,
                           planned_hours, headcount, created_by)
  values (p_project, p_date, p_start, p_end, p_hours, 1, (select auth.uid()))
  returning id into v_pass;

  update public.tilldelning t
  set released_at = now(), released_reason = 'replaced_by_snabb', released_by = (select auth.uid())
  where t.worker_id = p_worker and t.work_date = p_date and t.released_at is null;

  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  values (v_pass, p_worker, 'snabb', p_date);

  return v_pass;
end $fn$;
