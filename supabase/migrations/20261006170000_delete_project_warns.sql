-- ============================================================================
-- TA BORT PROJEKT WARNS INSTEAD OF REFUSING (owner, 2026-10-06)
--
-- delete_project() refused while anybody was booked on one of the project's
-- days from today on: "Projektet har pass med bokad personal framåt i
-- tiden. Avboka dem först, eller låt projektet ligga kvar." The owner wants
-- a warning that can be gone past, and decided what going past it does:
--
--   - Every pass on the project that has NOT STARTED is cancelled exactly as
--     Ta bort detta pass cancels one -- through public.delete_pass(), so the
--     same trigger releases everybody on it as shift_deleted, tells each of
--     them, withdraws open offers and blocks the pass from being offered to
--     them again. Then the project is removed.
--   - A pass RUNNING RIGHT NOW still refuses, with or without the warning: a
--     started shift is a fact to be confirmed (the same rule as deleting one
--     pass), and a removed project's hours count nowhere (invariant 8).
--     Shifts that already ended -- earlier today or before -- are past work
--     and never blocked, as before.
--
-- p_cancel_future defaults to FALSE, so a caller that does not ask -- an old
-- bundle still in somebody's browser -- gets exactly the old refusal. The
-- screen asks public.project_delete_impact() first and says how many passes
-- and people the press will cancel before it is made.
-- ============================================================================

drop function public.delete_project(uuid);

create function public.delete_project(p_project uuid, p_cancel_future boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted timestamptz;
  r record;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('project', p_project);
  -- Not app.leads_project(): that one falls back to is_admin(), which reads
  -- the right way round here but says the wrong thing. Deleting a project is
  -- an admin act, not a leader act that an admin happens to also be allowed.
  if not app.is_admin() then
    raise exception 'only an admin deletes a project'
      using errcode = 'insufficient_privilege';
  end if;

  select p.deleted_at into v_deleted from public.project p where p.id = p_project;

  if not found then
    raise exception 'no such project' using errcode = 'check_violation';
  end if;

  if v_deleted is not null then
    raise exception 'project is already deleted' using errcode = 'check_violation';
  end if;

  -- Somebody booked on a shift that has not started: refused unless the
  -- caller has shown the warning and the admin went past it.
  if not p_cancel_future and exists (
    select 1
      from public.pass p
      join public.tilldelning t on t.pass_id = p.id
     where p.project_id = p_project
       and p.deleted_at is null
       and now() < app.pass_start_at(p.work_date, p.start_time)
       and t.released_at is null
  ) then
    raise exception 'project has active passes with workers assigned'
      using errcode = 'check_violation';
  end if;

  -- A shift running right now: refused whatever the caller says.
  if exists (
    select 1
      from public.pass p
      join public.tilldelning t on t.pass_id = p.id
     where p.project_id = p_project
       and p.deleted_at is null
       and now() >= app.pass_start_at(p.work_date, p.start_time)
       and now() <  app.pass_end_at(p.work_date, p.start_time, p.end_time)
       and t.released_at is null
  ) then
    raise exception 'project has a shift running now; it ends or is closed before the project goes'
      using errcode = 'check_violation';
  end if;

  -- Every pass not yet started goes the way Ta bort detta pass sends one.
  for r in
    select p.id
      from public.pass p
     where p.project_id = p_project
       and p.deleted_at is null
       and now() < app.pass_start_at(p.work_date, p.start_time)
  loop
    perform public.delete_pass(r.id);
  end loop;

  update public.project set deleted_at = now() where id = p_project;
end $$;

revoke all on function public.delete_project(uuid, boolean) from public;
grant execute on function public.delete_project(uuid, boolean) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- What the warning says: passes not yet started, the people booked on them,
-- and whether a shift is running now. Admin only, inside the tenancy.
-- ----------------------------------------------------------------------------
create or replace function public.project_delete_impact(p_project uuid)
returns table (passes integer, people integer, running boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.guard_tenant('project', p_project);
  if not app.is_admin() then
    raise exception 'only an admin deletes a project'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    (select count(*)::int from public.pass p
      where p.project_id = p_project and p.deleted_at is null
        and now() < app.pass_start_at(p.work_date, p.start_time)),
    (select count(distinct t.worker_id)::int
       from public.pass p join public.tilldelning t on t.pass_id = p.id
      where p.project_id = p_project and p.deleted_at is null
        and now() < app.pass_start_at(p.work_date, p.start_time)
        and t.released_at is null and t.source <> 'ledare'),
    exists (select 1
       from public.pass p join public.tilldelning t on t.pass_id = p.id
      where p.project_id = p_project and p.deleted_at is null
        and now() >= app.pass_start_at(p.work_date, p.start_time)
        and now() <  app.pass_end_at(p.work_date, p.start_time, p.end_time)
        and t.released_at is null);
end $$;

revoke all on function public.project_delete_impact(uuid) from public, anon;
grant execute on function public.project_delete_impact(uuid) to authenticated;
