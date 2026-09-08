-- ============================================================================
-- REDIGERA OCH TA BORT PROJEKT
--
-- Alla Projekt gets an edit page. Two things follow from that, and neither of
-- them is cosmetic.
--
-- 1. A DELETED PROJECT MUST LEAVE THE ADMIN'S SIGHT.
--
-- Invariant 8 says a deleted project makes its shifts count nowhere IN EVERY
-- READ, and the derived views already carry
--     join public.project pr on pr.id = ... and pr.deleted_at is null
-- to that end -- my_shift, open_pass, the review queue, cancelled_day, all of
-- them. The DIRECT reads of public.project did not. project_staff_select
-- filters deleted_at, so a leader and a worker were already covered; but
-- project_admin_write is an ALL policy USING (app.is_admin()) with no such
-- test. The one role that can delete a project was the one role that would
-- still see it afterwards -- in Alla Projekt, and in the project pickers on
-- Arbetsdagbok, Nytt Pass, Snabb Pass and Alla Pass.
--
-- The filter goes in the policy rather than into those five callers, for the
-- same reason it sits in pass_leader_select rather than in every query that
-- reads a shift: invariant 8 is not a rule each caller is trusted to remember.
--
-- 2. ADDING THAT FILTER IS WHAT MAKES THE FUNCTION BELOW NECESSARY.
--
-- RLS is re-applied to the row a BEFORE UPDATE produces, so a policy carrying
-- "deleted_at is null" makes the new row fail its own policy the instant the
-- column is set. That is the wall public.delete_pass() was written against,
-- and narrowing the policy above walks project into it: from here on, setting
-- project.deleted_at from the client is impossible for every role, admin
-- included. So deletion goes through a SECURITY DEFINER function -- which is
-- also the only place the refusal can live where the interface cannot skip it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The policy
--
-- WITH CHECK carries the filter too, not just USING. Without it an admin could
-- still set deleted_at by hand whenever the write asked for no row back:
-- PostgREST omits the RETURNING clause on a bare .update(), so nothing would
-- re-read the row and nothing would catch it. Deletion has one route.
-- ---------------------------------------------------------------------------
drop policy if exists project_admin_write on public.project;
create policy project_admin_write on public.project
  for all to authenticated
  using (app.is_admin() and deleted_at is null)
  with check (app.is_admin() and deleted_at is null);

-- ---------------------------------------------------------------------------
-- 2. The deletion
--
-- The refusal is "today and future", not "ever". A project whose work is done
-- has released assignments on past passes and must stay deletable -- blocking
-- on any assignment that ever existed would make every finished project
-- permanent. What blocks is somebody standing on a day that has not happened
-- yet, which is the thing a deletion would actually take away from them.
--
-- Deleted passes do not count: they are already gone under invariant 8.
-- Released assignments do not count: the slot was vacated. Any live
-- tilldelning does, arbetsledare rows included -- a leader auto-assigned to a
-- day is a person booked onto it, and the edit page is not the place to
-- discover that the day still had someone on it.
-- ---------------------------------------------------------------------------
create or replace function public.delete_project(p_project uuid) returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_deleted timestamptz;
begin
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

  if exists (
    select 1
      from public.pass p
      join public.tilldelning t on t.pass_id = p.id
     where p.project_id  = p_project
       and p.deleted_at is null
       and p.work_date  >= app.stockholm_today()   -- INVARIANT 9, Stockholm
       and t.released_at is null
  ) then
    raise exception 'project has active passes with workers assigned'
      using errcode = 'check_violation';
  end if;

  update public.project set deleted_at = now() where id = p_project;
end $fn$;

revoke all on function public.delete_project(uuid) from public;
grant execute on function public.delete_project(uuid) to authenticated;
