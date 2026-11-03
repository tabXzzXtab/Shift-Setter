-- ============================================================================
-- TWO BUGS FIXED.
--
-- BUG 1 -- ONBOARDING TOUR REPLAYS ON EVERY LOGIN.
--
-- The tour stored "has seen" in localStorage, which the iOS WebView (loading
-- a remote URL) clears between sessions. Every new login was a first launch.
--
-- Fix: add has_seen_tour to account and a SECURITY DEFINER RPC to set it.
-- The frontend checks the DB flag first; localStorage stays as a fast-path
-- cache for the same session. An account that has seen the tour on any device
-- never sees it again anywhere.
--
-- BUG 2 -- ADMIN CANNOT DIRECTLY MANAGE AN ARBETSLEDARE'S ASSIGNMENT.
--
-- (a) The dag-panel hid the trash icon for ledare rows entirely. Admin had
--     to go through the replacement flow (replace_leader) even when they just
--     wanted to clear the day and start over. New RPC: admin_release_leader.
--
-- (b) An admin cannot manually place a specific ledare on a day. The only
--     route was sync_leader_day (automatic, trigger-driven). When the ledare
--     was committed elsewhere, or the pass had no workers yet, the row never
--     appeared. New RPC: admin_assign_leader.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BUG 1: has_seen_tour on account
-- ---------------------------------------------------------------------------

alter table public.account
  add column if not exists has_seen_tour boolean not null default false;

comment on column public.account.has_seen_tour is
  'Set the first time the onboarding tour runs for this account. Persisted in '
  'the database so it survives device changes and WebView storage clears.';

-- Expose it through account_directory so useAccount() can read it in one
-- query. The view is SECURITY DEFINER, owner postgres; recreating it here is
-- safe because account_directory is rebuilt by later migrations too.
create or replace view public.account_directory with (security_invoker = false) as
 SELECT a.id,
    a.role,
    a.active,
    a.has_seen_tour,
    w.id AS worker_id,
    COALESCE(w.name, u.raw_user_meta_data ->> 'name'::text) AS name,
    COALESCE(w.email, u.email::text) AS email,
    p.avatar_path
   FROM public.account a
     LEFT JOIN public.worker w ON w.account_id = a.id AND w.deleted_at IS NULL
     LEFT JOIN auth.users u ON u.id = a.id
     LEFT JOIN public.profile p ON p.account_id = a.id
  WHERE a.deleted_at IS NULL AND app.in_tenant(a.tenant_id)
    AND (app.is_admin() OR a.id = (( SELECT auth.uid() AS uid)));

-- RPC: an account marks its own tour as seen.
--
-- SECURITY DEFINER: account has no direct UPDATE on its own row (RLS blocks
-- it). A logged-in user may only mark their own account.
CREATE OR REPLACE FUNCTION public.mark_tour_seen()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.account
  set has_seen_tour = true
  where id = (select auth.uid())
    and has_seen_tour = false;
end $function$;

comment on function public.mark_tour_seen() is
  'Sets has_seen_tour = true for the calling account. Idempotent. '
  'Called the first time the onboarding tour starts for that account.';

-- ---------------------------------------------------------------------------
-- BUG 2a: admin_release_leader -- bypass the replacement flow
-- ---------------------------------------------------------------------------

-- The existing avboka_pass refuses a source='ledare' row. The existing
-- release_assignment works for workers but adds a pass_block (worker will
-- never be re-offered this pass), which makes no sense for a ledare.
-- This function does the right thing: release the row, record it as a
-- deliberate removal so sync_leader_day won't auto-place them again,
-- and then re-run sync_leader_day in case another leader can cover the day.

CREATE OR REPLACE FUNCTION public.admin_release_leader(p_tilldelning uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.tilldelning;
begin
  -- Admin only.
  if not app.is_admin() then
    raise exception 'only an admin may use this route'
      using errcode = 'insufficient_privilege';
  end if;

  -- Tenant fence.
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
    return; -- already released, idempotent
  end if;

  -- 'removed_by_leader' is the tombstone sync_leader_day respects: the ledare
  -- won't be auto-placed back on this day unless an admin manually assigns them.
  update public.tilldelning t
  set released_at     = now(),
      released_reason = 'removed_by_leader',
      released_by     = (select auth.uid())
  where t.id = p_tilldelning;

  -- Try to fill the day from other available leaders of this project.
  perform app.sync_leader_day(v_row.project_id, v_row.work_date);
end $function$;

comment on function public.admin_release_leader(uuid) is
  'Admin-only: remove an arbetsledare from a day without going through the '
  'replacement flow. Marks the row removed_by_leader so sync_leader_day does '
  'not put them back automatically, then tries to fill the day from other '
  'leaders of the same project.';

-- ---------------------------------------------------------------------------
-- BUG 2b: admin_assign_leader -- manually place a ledare on a pass's day
-- ---------------------------------------------------------------------------

-- Called when the admin wants a specific ledare on a project-day, whether or
-- not that ledare was placed automatically by the trigger. Also the route
-- when the trigger blocked placement (ledare committed elsewhere, no workers
-- on the pass yet, etc.).
--
-- Calling this on a ledare who was previously removed with removed_by_leader
-- is intentional: admin overrides their own earlier decision.

CREATE OR REPLACE FUNCTION public.admin_assign_leader(p_pass uuid, p_worker uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pass    public.pass;
  v_acct    public.account;
  v_start   time;
  v_end     time;
begin
  -- Admin only.
  if not app.is_admin() then
    raise exception 'only an admin may use this route'
      using errcode = 'insufficient_privilege';
  end if;

  -- Tenant fence on the pass.
  perform app.guard_tenant('pass', p_pass);

  select p.* into v_pass
  from public.pass p
  where p.id = p_pass and p.deleted_at is null;

  if v_pass.id is null then
    raise exception 'no such pass' using errcode = 'check_violation';
  end if;

  -- Verify the worker is an aktiv arbetsledare in the same tenant.
  select a.* into v_acct
  from public.account a
  join public.worker  w on w.account_id = a.id and w.id = p_worker
  where a.role      = 'arbetsledare'
    and a.active
    and a.deleted_at is null
    and app.in_tenant(a.tenant_id);

  if v_acct.id is null then
    raise exception 'worker % is not an active arbetsledare in this tenant', p_worker
      using errcode = 'check_violation';
  end if;

  -- Envelope: earliest start to latest end across ALL workers on this
  -- project that day. Falls back to the pass's own times when no workers
  -- are assigned yet (admin placing the ledare before workers arrive).
  select coalesce(min(p2.start_time), v_pass.start_time),
         coalesce(max(p2.end_time),   v_pass.end_time)
    into v_start, v_end
  from public.tilldelning t
  join public.pass p2 on p2.id = t.pass_id and p2.deleted_at is null
  where t.project_id  = v_pass.project_id
    and t.work_date   = v_pass.work_date
    and t.released_at is null
    and t.source     <> 'ledare';

  -- Clear any stale tombstone so the insert below succeeds.
  -- Only the admin's own deliberate removal: 'no_workers_left' tombstones
  -- are what sync_leader_day uses and we leave them for it to read.
  update public.tilldelning t
  set released_at     = null,
      released_reason = null,
      released_by     = null,
      pass_id         = v_pass.id,
      own_start       = v_start,
      own_end         = v_end
  where t.worker_id       = p_worker
    and t.work_date       = v_pass.work_date
    and t.project_id      = v_pass.project_id
    and t.source          = 'ledare'
    and t.released_reason = 'removed_by_leader';

  -- If no stale row, insert fresh.
  if not found then
    insert into public.tilldelning
      (pass_id, worker_id, source, work_date, project_id, own_start, own_end)
    values
      (v_pass.id, p_worker, 'ledare', v_pass.work_date,
       v_pass.project_id, v_start, v_end)
    on conflict do nothing;
  end if;
end $function$;

comment on function public.admin_assign_leader(uuid, uuid) is
  'Admin-only: manually place a specific arbetsledare on the day a pass '
  'belongs to. Works even when the auto-trigger blocked placement (ledare '
  'committed elsewhere, no workers yet). Also un-does a prior admin removal.';

-- Grant execute to authenticated so PostgREST can call them.
grant execute on function public.mark_tour_seen()                   to authenticated;
grant execute on function public.admin_release_leader(uuid)         to authenticated;
grant execute on function public.admin_assign_leader(uuid, uuid)    to authenticated;
