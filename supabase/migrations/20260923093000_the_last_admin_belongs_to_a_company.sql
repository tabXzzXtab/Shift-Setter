-- ============================================================================
-- THE LAST ADMIN BELONGS TO A COMPANY, AND SO DOES A FLAGGED DAY.
--
-- M2a scoped everything that goes through a policy. M2b scoped the SECURITY
-- DEFINER functions by the uuid they are handed. Neither reaches the two
-- things below, because neither is asked about a row a caller named:
--
--   a guard that COUNTS admins, to decide whether one may go, and
--   a fan-out that SELECTS admins, to decide who hears about a flagged day.
--
-- Both ask "who are the admins" without asking whose, and both were written
-- when there was only one company in the database and that was the same
-- question.
--
-- INVARIANT 11, RESTATED PER COMPANY. "The last active admin cannot be
-- removed, demoted or paused" now counts inside the tenancy the account is
-- leaving. The guard counted every tenancy, so Bella Service AB's single
-- admin could be paused while Korperation's two stood in for them -- and the
-- company would be left with nobody who can administer it. That is the exact
-- state the invariant exists to prevent, and being recoverable BY THE
-- OPERATOR is not the same as being recoverable. A client who cannot get back
-- into their own account without ringing us is locked out.
--
-- Decided by the owner, not here: operator super admins do not count as a
-- client's safety net.
--
-- THE THIRD FINDING IS ALREADY FIXED and is named here so it is not silently
-- dropped: public.forval_coverage counted every company's available workers
-- into one company's shortfall warning. M2b added
-- `and w.tenant_id = app.current_tenant_id()`, and batch_shortfall inherits it
-- by delegation. Verified against the live catalogue; nothing to do.
--
-- fel.ts IS NOT TOUCHED. Its needle is "this is the last active admin", which
-- the new message still opens with, and the Swedish it maps to reads correctly
-- for the only person who ever sees it -- a client admin, for whom their own
-- company is the only one that exists.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- INVARIANT 11, per company.
--
-- Two changes, and the second is the one that is easy to miss.
--
-- The COUNT gains `a.tenant_id = old.tenant_id`: the admins that matter are
-- the ones left in the company this row is leaving.
--
-- The EARLY EXIT gains `new.tenant_id = old.tenant_id`. Without it, "still an
-- active admin" is true of an account MOVED to another tenancy, and the
-- company it left keeps no admin at all -- the count below never runs. Only a
-- super admin can write that UPDATE (account_admin_write's WITH CHECK refuses
-- the new row to anybody else), which makes it precisely the person this
-- guard has to be able to answer.
--
-- A null tenancy cannot arise -- account.tenant_id is NOT NULL -- but if it
-- ever did, `a.tenant_id = NULL` matches no rows, the count is zero and the
-- guard refuses. A null is a denial (CLAUDE.md, gotcha 3), which is the right
-- way round for a guard.
-- ---------------------------------------------------------------------------

create or replace function app.tg_last_admin_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_remaining integer;
  v_was_admin boolean;
begin
  v_was_admin := (old.role = 'admin' and old.active);

  if not v_was_admin then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Still an active admin OF THE SAME COMPANY, so nothing is lost.
  if tg_op = 'UPDATE' and new.role = 'admin' and new.active
     and new.tenant_id = old.tenant_id then
    return new;
  end if;

  select count(*) into v_remaining
  from public.account a
  where a.role = 'admin'
    and a.active
    and a.id <> old.id
    and a.tenant_id = old.tenant_id;

  if v_remaining = 0 then
    raise exception 'this is the last active admin in this company; it cannot be removed, demoted or paused'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;

-- ---------------------------------------------------------------------------
-- A flagged day reaches the company it happened in.
--
-- Everything else in this function is unchanged, copied from the live
-- definition rather than retyped: the admin check, take_leader_off, the
-- upsert onto project_day. One WHERE clause moves.
--
-- WHO HEARS: every active admin of the day's own company -- taken from
-- v_row.tenant_id, the assignment's tenancy, which M1c derived from the pass
-- and the project rather than from whoever wrote it. An operator super admin
-- hears only while ACTING in that company, which is the one moment they are
-- inside it on purpose; the rest of the time a client's flagged day is not
-- theirs to be told about. It reached every admin of every company before
-- this, carrying project_id, work_date and the flag with it.
--
-- The notification row's own tenant_id derives from its account, so a super
-- admin acting in a client's company still gets the row filed under theirs
-- and can read it afterwards. That is correct: they are being told, and the
-- telling is a fact about them.
-- ---------------------------------------------------------------------------

create or replace function app.flag_day(
  p_tilldelning uuid,
  p_flag        public.confirmation_source,
  p_worker      uuid
) returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_row public.tilldelning;
begin
  if not app.is_admin() then
    raise exception 'only an admin lets a day run without an arbetsledare'
      using errcode = 'insufficient_privilege';
  end if;

  v_row := app.take_leader_off(p_tilldelning);

  insert into public.project_day (project_id, work_date, flagged_as, ansvarig_worker_id)
  values (v_row.project_id, v_row.work_date, p_flag, p_worker)
  on conflict (project_id, work_date) do update
    set flagged_as = p_flag, ansvarig_worker_id = p_worker;

  -- Highlighted in the queue is not enough on its own: a day nobody was
  -- answerable for should reach the admin without them going to look.
  insert into public.notification (account_id, kind, payload)
  select a.id, 'day_flagged',
         jsonb_build_object('project_id', v_row.project_id,
                            'work_date', v_row.work_date,
                            'flagged_as', p_flag)
  from public.account a
  where a.role = 'admin'
    and a.active
    and (a.tenant_id = v_row.tenant_id
         or (a.super_admin
             and exists (select 1 from app.acting_tenant t
                          where t.account_id = a.id
                            and t.tenant_id = v_row.tenant_id)));
end $fn$;
