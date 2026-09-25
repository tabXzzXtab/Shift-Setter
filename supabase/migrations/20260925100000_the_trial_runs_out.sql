-- ============================================================================
-- M3 -- THE TRIAL RUNS OUT.
--
-- tenant.expires_at has been carried since M1 and read by nothing. A demo
-- tenancy is created with three weeks on it, the operator's list prints "Går
-- ut 2026-10-14", and on the fifteenth the customer goes on working exactly as
-- before. A date nothing enforces is a note, not a term.
--
-- WHERE IT IS ENFORCED, AND WHY THERE. app.current_tenant_id() is the single
-- place every policy narrows through: 34 of them call app.in_tenant(), which
-- compares against this function's answer. An expired tenancy resolving to
-- NULL therefore closes every table at once, in the database, without a guard
-- per table that somebody could forget to add to the thirty-fifth. NULL is a
-- denial here for the reason CLAUDE.md's third gotcha gives -- `p_tenant =
-- NULL` is NULL, and in_tenant() coalesces to false -- so this is the existing
-- mechanism doing what it already does, not a new one.
--
-- THE OPERATOR IS EXEMPT, DELIBERATELY. The check sits only on the branch that
-- reads the caller's OWN tenancy. A super admin who has entered a client keeps
-- the answer they entered with, because the sentence the client is about to
-- read tells them to contact us -- and an instruction we have made
-- unfollowable is worse than no instruction. Renewing an expired customer,
-- or looking at what they have, means being able to get in.
--
-- WHAT A LOCKED-OUT TENANCY CAN STILL DO, because a lockout nobody can read is
-- indistinguishable from an outage: public.tenant_status() below answers
-- "whose am I and has it run out" from outside RLS, so the app can say the
-- Swedish sentence instead of drawing an empty screen. Reading your own
-- account row also still works -- M2a hoisted `id = auth.uid()` outside the
-- tenant clause -- so the app can still tell them who they are while telling
-- them they are out.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The expiry itself.
--
-- Copied from the live definition with one join added, so the acting branch
-- and the coalesce shape are unchanged rather than retyped.
--
-- expires_at IS NULL MEANS FOREVER, which is what every paying tenancy and
-- the operator's own carry. Only account_type = 'demo' is required to hold a
-- date (the check constraint in M1 says so), so null-as-forever is the state
-- almost every row is in and has to be the cheap branch.
--
-- `tn.expires_at > now()` rather than >=: at the instant it expires, it has.
-- now() is transaction-start time and constant for the transaction (gotcha 4),
-- which is the right behaviour here -- one request does not straddle the
-- boundary and see half a database.
-- ---------------------------------------------------------------------------

create or replace function app.current_tenant_id() returns uuid
  language sql stable security definer
  set search_path = ''
as $fn$
  select coalesce(
    case when app.is_super_admin()
         then (select t.tenant_id from app.acting_tenant t where t.account_id = (select auth.uid()))
    end,
    (select a.tenant_id
       from public.account a
       join public.tenant tn on tn.id = a.tenant_id
      where a.id = (select auth.uid())
        and a.active
        and (tn.expires_at is null or tn.expires_at > now())))
$fn$;

comment on function app.current_tenant_id() is
  'The tenancy every policy narrows to. NULL when the account is missing, '
  'paused, or its tenancy has expired -- all three are denials. A super admin '
  'acting inside a tenancy keeps it whether or not that tenancy has expired.';

-- ---------------------------------------------------------------------------
-- 2. How a locked-out tenancy finds out.
--
-- Everything this account can reach has just gone dark, so it cannot read
-- public.tenant to learn why -- tenant_member_select narrows through
-- in_tenant() like everything else, and that is now false for them. Without
-- this they would meet an app with no projects, no shifts and no explanation,
-- which reads as a fault in the product rather than a bill to pay.
--
-- SECURITY DEFINER because that is the whole point: it answers from outside
-- the isolation it is reporting on. It is safe to expose because it takes NO
-- ARGUMENT and is keyed on auth.uid() -- there is no id to substitute for
-- somebody else's, so the only row it can ever return is the caller's own.
--
-- It reports the caller's OWN tenancy, not the one an operator is acting in.
-- The question it exists to answer is "am I locked out", and an operator
-- standing inside an expired client is not.
-- ---------------------------------------------------------------------------

create or replace function public.tenant_status()
  returns table (tenant_id uuid,
                 name text,
                 account_type public.tenant_account_type,
                 expires_at timestamptz,
                 expired boolean)
  language sql stable security definer
  set search_path = ''
as $fn$
  select tn.id, tn.name, tn.account_type, tn.expires_at,
         (tn.expires_at is not null and tn.expires_at <= now())
    from public.account a
    join public.tenant tn on tn.id = a.tenant_id
   where a.id = (select auth.uid())
$fn$;

comment on function public.tenant_status() is
  'The caller''s own tenancy and whether it has run out. Readable from inside '
  'a locked-out tenancy, which is the only place it matters.';

revoke all on function public.tenant_status() from public;
grant execute on function public.tenant_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Invariant 11, one line further.
--
-- da94053 made the count per-company, which was the change that mattered. It
-- counts `role = 'admin' and active`, and public.account also carries
-- deleted_at.
--
-- Those two agree today only because public.delete_account() writes
-- `active = false, deleted_at = now()` in one statement. Nothing enforces the
-- pairing -- no constraint, no trigger -- so the guard is one careless UPDATE
-- away from counting a shut-down account as the admin a company still has.
-- That is precisely the row invariant 11 must not accept as cover: an account
-- that has been removed from the product is not somebody who can administer
-- it.
--
-- Stricter, never looser: it can only ever find FEWER remaining admins, so it
-- can only ever refuse where it used to allow. Everything else is da94053's,
-- copied rather than rewritten.
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
    and a.deleted_at is null
    and a.id <> old.id
    and a.tenant_id = old.tenant_id;

  if v_remaining = 0 then
    raise exception 'this is the last active admin in this company; it cannot be removed, demoted or paused'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;
