-- ============================================================================
-- ENTERING A TENANCY NARROWS THE DATABASE, NOT THE SCREEN.
--
-- A super admin can read every tenant, which is what lets Korperation support
-- a customer at all. This is how they put that down on purpose: enter one
-- tenancy, see only it, leave again. Separate from the policy migration so the
-- two revert independently -- but note that reverting THIS one means restoring
-- app.in_tenant() and app.current_tenant_id() to their two-line forms, because
-- it redefines both. They are listed at the foot of this comment.
--
-- WHY A TABLE AND NOT `SET LOCAL`. The obvious shape is a session variable,
-- and it cannot work: PostgREST runs every request in its own transaction, and
-- SET LOCAL is reverted when that transaction ends. enter_tenant() would set
-- it, return ok, and the redirect that followed would arrive with nothing set.
-- A table survives the request, the reload, the reconnect and the pooler, and
-- it can be read -- who is inside whose tenancy right now is a question worth
-- being able to answer.
--
-- THE FUNCTIONS ARE IN public, THE TABLE IS IN app. PostgREST only serves its
-- exposed schemas and `app` is not one, so a function there could not be
-- called from the browser at all. The table stays in app precisely because
-- nothing should reach it except these two.
--
-- ---------------------------------------------------------------------------
-- TWO THINGS THIS HAD TO FIX TO WORK AT ALL:
--
-- 1. app.in_tenant() SHORT-CIRCUITED ON is_super_admin(), so the acting tenant
--    would have changed nothing. `is_super_admin() or p_tenant =
--    current_tenant_id()` is true for a super admin on every row no matter
--    what current_tenant_id() returns. The bypass now applies only while they
--    are NOT acting, which is what makes entering mean something.
--
-- 2. A SUPER ADMIN COULD NOT READ THEIR OWN ACCOUNT ROW while acting. Their
--    account lives in Korperation; acting as a client scopes them to the
--    client; account_self_or_admin_select then matched nothing for them. The
--    policy now puts `id = auth.uid()` OUTSIDE the tenant clause: your own
--    account row is yours whatever tenancy you are standing in. That is true
--    for everybody and not a special case for operators -- it was only ever
--    invisible because nobody could previously be outside their own tenant.
--
-- Reverting restores:
--   app.in_tenant(uuid)      -> coalesce(app.is_super_admin() or p_tenant = app.current_tenant_id(), false)
--   app.current_tenant_id()  -> select a.tenant_id from public.account a where a.id = (select auth.uid()) and a.active
--   account_self_or_admin_select -> using (app.in_tenant(tenant_id) and ((id = (select auth.uid())) or app.is_admin()))
-- ============================================================================

create table app.acting_tenant (
  account_id uuid primary key references public.account (id) on delete cascade,
  tenant_id  uuid not null references public.tenant (id) on delete cascade,
  entered_at timestamptz not null default now()
);

-- No grants and no policies: `app` is not an exposed schema, `authenticated`
-- holds no privilege on tables in it, and the only writers are the two
-- SECURITY DEFINER functions below. RLS on as a second wall rather than a
-- first one.
alter table app.acting_tenant enable row level security;

-- ---------------------------------------------------------------------------
-- Who is acting, and as whom.
-- ---------------------------------------------------------------------------

create or replace function app.is_acting() returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (select 1 from app.acting_tenant t where t.account_id = (select auth.uid()))
$$;

-- THE ACTING TENANT WINS, and only for a super admin. A row here for anybody
-- else is meaningless by construction -- enter_tenant refuses to write one --
-- but the is_super_admin() test is repeated here rather than assumed, because
-- a table that grew a stray row must not silently move somebody's tenancy.
create or replace function app.current_tenant_id() returns uuid
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(
    case when app.is_super_admin()
         then (select t.tenant_id from app.acting_tenant t where t.account_id = (select auth.uid()))
    end,
    (select a.tenant_id from public.account a where a.id = (select auth.uid()) and a.active))
$$;

-- The bypass, now suppressed while acting. Without that clause entering a
-- tenancy would change nothing at all for the person doing it.
create or replace function app.in_tenant(p_tenant uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(
    p_tenant = app.current_tenant_id()
    or (app.is_super_admin() and not app.is_acting()),
    false)
$$;

-- ---------------------------------------------------------------------------
-- Enter, and leave.
-- ---------------------------------------------------------------------------

create or replace function public.enter_tenant(p_tenant uuid) returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  if not app.is_super_admin() then
    raise exception 'only a super admin can enter another tenant'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.tenant t where t.id = p_tenant) then
    raise exception 'no such tenant' using errcode = 'check_violation';
  end if;

  insert into app.acting_tenant (account_id, tenant_id)
  values ((select auth.uid()), p_tenant)
  on conflict (account_id) do update
    set tenant_id = excluded.tenant_id, entered_at = now();
end $fn$;

-- NO GUARD ON LEAVING, deliberately. exit_tenant deletes the caller's own row
-- and nothing else, so the worst it can do is put somebody back where they
-- started. A super admin who has scoped themselves into a client tenancy needs
-- the way out to work even if something about their state is wrong -- a Lämna
-- button that can itself be refused is a trap.
create or replace function public.exit_tenant() returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  delete from app.acting_tenant where account_id = (select auth.uid());
end $fn$;

revoke all on function public.enter_tenant(uuid) from public;
revoke all on function public.exit_tenant() from public;
grant execute on function public.enter_tenant(uuid) to authenticated;
grant execute on function public.exit_tenant() to authenticated;

-- ---------------------------------------------------------------------------
-- Your own account row is yours, whatever tenancy you are standing in.
-- ---------------------------------------------------------------------------

drop policy account_self_or_admin_select on public.account;
create policy account_self_or_admin_select on public.account
  for select to authenticated
  using (
    -- Outside the tenant clause on purpose: see note 2 in the header.
    (id = ( SELECT auth.uid() AS uid))
    or (app.in_tenant(tenant_id) and app.is_admin()));

-- ---------------------------------------------------------------------------
-- The tenant list narrows too.
--
-- tenant_member_select was written in the policy migration as a direct
-- `app.is_super_admin() or id = app.current_tenant_id()`, which predates
-- there being anything to suppress -- so while acting, an operator still saw every
-- client's name and organisationsnummer. Routing it through in_tenant() gives
-- it the same suppression as the other thirty-four: the whole list when they
-- are not acting, the one tenancy they entered when they are.
--
-- Reverting restores:
--   using (app.is_super_admin() or id = app.current_tenant_id())
-- ---------------------------------------------------------------------------

drop policy tenant_member_select on public.tenant;
create policy tenant_member_select on public.tenant
  for select to authenticated
  using (app.in_tenant(id));

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
