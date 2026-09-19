-- ============================================================================
-- M2-0 -- push_token becomes the 20th tenant-scoped table.
--
-- It was created after M1 and so missed both halves of the tenant work: the
-- column M1 put on nineteen tables, and the parent-derivation trigger M1c gave
-- seventeen of them. Left alone it is a routing table with no tenancy, which
-- is the same shape as the shadow dataset that cost a day to clean -- a sender
-- reading it would fan one company's notifications across every company's
-- devices.
--
-- STRUCTURAL, NOT POLICY, which is why it goes ahead of M2a rather than inside
-- it. M2a rewrites 34 policies and can take every read path down if one clause
-- is wrong; this adds a column and a trigger and cannot. They should be
-- revertable separately.
--
-- ITS RLS NEEDS NOTHING FROM M2a. push_token has row level security enabled
-- and ZERO policies, which denies every logged-in user outright -- that is
-- deliberate (a device token is a routing address; handing it to a logged-in
-- user buys nothing and leaks a way to address somebody's phone). The only
-- writers are register_push_token and forget_push_token, both SECURITY
-- DEFINER, and both already key on auth.uid() so they cannot reach another
-- account. M2b will confirm that rather than change it.
-- ============================================================================

alter table public.push_token add column tenant_id uuid references public.tenant (id);

-- DERIVED PER ROW, not stamped from a literal. The table is empty today, so
-- this is a no-op right now -- but "empty when I looked" is not a property a
-- migration should depend on, and a token's tenant is its account's whatever
-- else is true. Safe as an UPDATE where M1's backfill was not: push_token
-- carries no guard triggers, being newer than all of them.
update public.push_token t
   set tenant_id = a.tenant_id
  from public.account a
 where a.id = t.account_id and t.tenant_id is null;

alter table public.push_token alter column tenant_id set not null;

-- The same composite key every other child carries, and DEFERRABLE for the
-- same reason: without it the account this row hangs off could never change
-- tenant, which is the constraint M1c had to rewrite twenty-two of.
alter table public.push_token add constraint push_token_tenant_matches_account
  foreign key (account_id, tenant_id) references public.account (id, tenant_id)
  deferrable initially immediate;

-- Derive from the parent, and refuse a tenant that disagrees with it. Named to
-- sort ahead of any guard added later, as the other seventeen are.
create trigger aa_tenant_from_parent before insert on public.push_token
  for each row execute function app.tg_tenant_from_parent('account', 'account_id');

create index push_token_tenant on public.push_token (tenant_id);

-- ---------------------------------------------------------------------------
-- THE HANDSET MOVES, AND ITS TENANT HAS TO MOVE WITH IT.
--
-- register_push_token is an upsert whose DO UPDATE sets account_id -- "whoever
-- signed in last owns the handset", the decision that table was built around.
-- A BEFORE INSERT trigger does not fire on the update half of an upsert, so
-- the row's account_id moved while tenant_id stayed where it was, and the
-- composite key added above refused it. Two people in DIFFERENT tenants
-- sharing a site phone is the case: within one tenant the value never had to
-- change and nothing showed.
--
-- Found by dry-running this migration against that exact sequence rather than
-- by reading it.
--
-- excluded.tenant_id is the right source and not a guess: Postgres fires
-- per-row BEFORE INSERT triggers on the proposed row before testing for a
-- conflict, and their effects are reflected in `excluded` precisely so that a
-- derived value survives into the update. So the trigger derives, and this
-- carries what it derived.
-- ---------------------------------------------------------------------------

create or replace function public.register_push_token(p_token text, p_platform text)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_account uuid := (select auth.uid());
begin
  if v_account is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- A paused or missing account has no role, and a three-valued result must
  -- never be a permission (CLAUDE.md, gotcha 3).
  if not coalesce(app.current_role() is not null, false) then
    raise exception 'this account is not active' using errcode = 'insufficient_privilege';
  end if;

  insert into public.push_token (token, account_id, platform, updated_at)
  values (btrim(p_token), v_account, p_platform, now())
  on conflict (token) do update
    -- THE MOVE. Whoever signed in last owns the handset.
    set account_id = excluded.account_id,
        tenant_id  = excluded.tenant_id,
        platform   = excluded.platform,
        updated_at = now();
end $fn$;

revoke all on function public.register_push_token(text, text) from public;
grant execute on function public.register_push_token(text, text) to authenticated;
