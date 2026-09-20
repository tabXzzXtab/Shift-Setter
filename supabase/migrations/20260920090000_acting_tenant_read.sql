-- ============================================================================
-- THE SCREEN HAS TO BE ABLE TO ASK "AM I INSIDE SOMEBODY'S TENANCY?"
--
-- enter_tenant and exit_tenant write the state; nothing could read it. The
-- banner that says "Du agerar som ... i ..." needs an answer that survives a
-- reload and a second device, so it cannot come from client state -- the
-- database knows, and the client must not be the one remembering.
--
-- INFERRING IT WOULD ALMOST WORK, AND THAT IS THE PROBLEM. public.tenant
-- returns every row to a super admin who is not acting and exactly one while
-- they are, so "count = 1 means acting" is nearly right -- and wrong on the
-- day a single tenant exists, which is precisely the day someone is setting
-- the product up for the first time. A question with an exact answer should
-- not be guessed from a row count.
--
-- SECURITY DEFINER because app.acting_tenant is not reachable from PostgREST
-- and must not become so: this returns the caller's own row and nothing else,
-- which is the only part of that table anybody outside it has business seeing.
-- ============================================================================

create or replace function public.acting_tenant()
  returns table (tenant_id uuid, tenant_name text, entered_at timestamptz)
  language sql stable security definer
  set search_path = ''
as $$
  select t.id, t.name, a.entered_at
    from app.acting_tenant a
    join public.tenant t on t.id = a.tenant_id
   where a.account_id = (select auth.uid())
$$;

revoke all on function public.acting_tenant() from public;
grant execute on function public.acting_tenant() to authenticated;
