-- ============================================================================
-- M1c -- A ROW'S TENANT COMES FROM ITS PARENT, NOT FROM WHOEVER WROTE IT.
--
-- M1 gave every table a tenant_id and the follow-up gave all 19 the default
-- app.current_tenant_id(). That default answers the wrong question for a child
-- row: it returns the CALLER'S tenant, while every composite key requires the
-- PARENT ROW'S. Those coincide only while the caller and the data live in one
-- tenancy, which stopped being true the moment Korperation and Bella Service
-- AB became separate tenants -- so every admin write failed:
--
--   notification  -> notification_tenant_matches_account
--   pass          -> pass_tenant_matches_project
--   project_day   -> project_day_tenant_matches_project
--   day_review    -> day_review_tenant_matches_project
--   pass_offer    -> pass_offer_tenant_matches_pass
--   project       -> SUCCEEDED, silently, into the wrong tenant
--
-- The same writes as a client's own arbetsledare were fine. The line is the
-- tenant, not the operation.
--
-- A COALESCE IN A TRIGGER CANNOT FIX THIS. Column defaults are applied BEFORE
-- a BEFORE INSERT trigger runs, so new.tenant_id is never null by the time a
-- trigger sees it -- it is already the caller's tenant. `coalesce(new.tenant_id,
-- <parent lookup>)` would take the left branch every time and do nothing. The
-- default has to come off first, which is what section 2 does.
--
-- account and project keep the default. They have no parent, so the caller's
-- tenancy is the only answer available. That leaves one hole this migration
-- does NOT close: a super admin creating a project still lands it in
-- Korperation, silently. It wants an explicit tenant on the create screen or a
-- refusal, and it is deliberately left for that decision rather than guessed
-- at here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. THE COMPOSITE KEYS BECOME DEFERRABLE.
--
-- Not tidying: without this NOTHING CAN EVER CHANGE TENANT, and section 1
-- below is impossible. Proved before writing it -- moving an account and its
-- profile fails in BOTH orders:
--
--   parent first -> "update on table account violates profile_tenant_matches_account on table profile"
--   child first  -> "update on table profile violates profile_tenant_matches_account"
--
-- There is no third order. A non-deferrable constraint is checked per
-- statement, and a subtree move is never consistent between two statements.
--
-- INITIALLY IMMEDIATE, so ordinary operation is unchanged: every write is
-- still checked the instant it happens. Only a transaction that explicitly
-- says SET CONSTRAINTS ... DEFERRED gets the window, and it closes again at
-- commit. This is what lets support move a mis-onboarded account later, which
-- is not a hypothetical -- it is the next thing that will be asked for.
-- ---------------------------------------------------------------------------

alter table public.worker drop constraint worker_tenant_matches_account;
alter table public.worker add constraint worker_tenant_matches_account
  foreign key (account_id, tenant_id) references public.account (id, tenant_id)
  deferrable initially immediate;

alter table public.profile drop constraint profile_tenant_matches_account;
alter table public.profile add constraint profile_tenant_matches_account
  foreign key (account_id, tenant_id) references public.account (id, tenant_id)
  deferrable initially immediate;

alter table public.notification drop constraint notification_tenant_matches_account;
alter table public.notification add constraint notification_tenant_matches_account
  foreign key (account_id, tenant_id) references public.account (id, tenant_id)
  deferrable initially immediate;

alter table public.personal_event drop constraint personal_event_tenant_matches_owner;
alter table public.personal_event add constraint personal_event_tenant_matches_owner
  foreign key (owner_id, tenant_id) references public.account (id, tenant_id)
  deferrable initially immediate;

alter table public.personal_event_viewer drop constraint pev_tenant_matches_account;
alter table public.personal_event_viewer add constraint pev_tenant_matches_account
  foreign key (account_id, tenant_id) references public.account (id, tenant_id)
  deferrable initially immediate;

alter table public.personal_event_viewer drop constraint pev_tenant_matches_event;
alter table public.personal_event_viewer add constraint pev_tenant_matches_event
  foreign key (event_id, tenant_id) references public.personal_event (id, tenant_id)
  deferrable initially immediate;

alter table public.project_leader drop constraint project_leader_tenant_matches_project;
alter table public.project_leader add constraint project_leader_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id)
  deferrable initially immediate;

alter table public.project_leader drop constraint project_leader_tenant_matches_account;
alter table public.project_leader add constraint project_leader_tenant_matches_account
  foreign key (account_id, tenant_id) references public.account (id, tenant_id)
  deferrable initially immediate;

alter table public.project_day drop constraint project_day_tenant_matches_project;
alter table public.project_day add constraint project_day_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id)
  deferrable initially immediate;

alter table public.day_review drop constraint day_review_tenant_matches_project;
alter table public.day_review add constraint day_review_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id)
  deferrable initially immediate;

alter table public.arbetsdagbok drop constraint arbetsdagbok_tenant_matches_project;
alter table public.arbetsdagbok add constraint arbetsdagbok_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id)
  deferrable initially immediate;

alter table public.pass drop constraint pass_tenant_matches_project;
alter table public.pass add constraint pass_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id)
  deferrable initially immediate;

alter table public.pass_batch drop constraint pass_batch_tenant_matches_project;
alter table public.pass_batch add constraint pass_batch_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id)
  deferrable initially immediate;

alter table public.pass_batch_handpick drop constraint handpick_tenant_matches_batch;
alter table public.pass_batch_handpick add constraint handpick_tenant_matches_batch
  foreign key (batch_id, tenant_id) references public.pass_batch (id, tenant_id)
  deferrable initially immediate;

alter table public.pass_batch_handpick drop constraint handpick_tenant_matches_worker;
alter table public.pass_batch_handpick add constraint handpick_tenant_matches_worker
  foreign key (worker_id, tenant_id) references public.worker (id, tenant_id)
  deferrable initially immediate;

alter table public.pass_block drop constraint pass_block_tenant_matches_pass;
alter table public.pass_block add constraint pass_block_tenant_matches_pass
  foreign key (pass_id, tenant_id) references public.pass (id, tenant_id)
  deferrable initially immediate;

alter table public.pass_block drop constraint pass_block_tenant_matches_worker;
alter table public.pass_block add constraint pass_block_tenant_matches_worker
  foreign key (worker_id, tenant_id) references public.worker (id, tenant_id)
  deferrable initially immediate;

alter table public.pass_offer drop constraint pass_offer_tenant_matches_pass;
alter table public.pass_offer add constraint pass_offer_tenant_matches_pass
  foreign key (pass_id, tenant_id) references public.pass (id, tenant_id)
  deferrable initially immediate;

alter table public.pass_offer drop constraint pass_offer_tenant_matches_worker;
alter table public.pass_offer add constraint pass_offer_tenant_matches_worker
  foreign key (worker_id, tenant_id) references public.worker (id, tenant_id)
  deferrable initially immediate;

alter table public.tilldelning drop constraint tilldelning_tenant_matches_pass;
alter table public.tilldelning add constraint tilldelning_tenant_matches_pass
  foreign key (pass_id, tenant_id) references public.pass (id, tenant_id)
  deferrable initially immediate;

alter table public.clock_edit drop constraint clock_edit_tenant_matches_tilldelning;
alter table public.clock_edit add constraint clock_edit_tenant_matches_tilldelning
  foreign key (tilldelning_id, tenant_id) references public.tilldelning (id, tenant_id)
  deferrable initially immediate;

alter table public.forval drop constraint forval_tenant_matches_worker;
alter table public.forval add constraint forval_tenant_matches_worker
  foreign key (worker_id, tenant_id) references public.worker (id, tenant_id)
  deferrable initially immediate;

-- ---------------------------------------------------------------------------
-- 1. ANTOINE GOES BACK TO BELLA SERVICE AB.
--
-- admin@bellaservice.se, the account that created every one of Bella Service
-- AB's projects, is their administrator and not Korperation's. M1 swept all
-- three admins into the founding tenant on a rule that read "every account
-- where role = 'admin' belongs to Korperation" -- correct for the two throwaway
-- logins, wrong for the client's own admin. This puts him back, and clears
-- super_admin: a client's administrator is not an operator of the product.
--
-- demo-admin@ and temp-admin@ stay in Korperation as super admins.
--
-- The profile and the notification travel with him, because the composite keys
-- demand they agree with their account's tenant. Nothing else does: he has no
-- worker row, no personal_event, no project_leader row. project.created_by
-- points at him from 66 projects and stays pointing across the tenant line --
-- it carries no tenant agreement, by design; it records who typed, not who
-- owns.
--
-- THE SUPER_ADMIN GUARD IS SWITCHED OFF FOR EXACTLY THIS STATEMENT. It refuses
-- any caller who is not already a super admin, and a migration has no
-- auth.uid() at all, so it would refuse this. Disabling is transactional: if
-- anything below fails, the trigger comes back with the rollback.
-- ---------------------------------------------------------------------------

alter table public.account disable trigger account_super_admin_guard;

set constraints public.profile_tenant_matches_account,
                public.notification_tenant_matches_account deferred;

update public.account
   set tenant_id = '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164', super_admin = false
 where id = 'eb82bf25-046d-4c0b-8e3a-260643448da7';

update public.profile
   set tenant_id = '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164'
 where account_id = 'eb82bf25-046d-4c0b-8e3a-260643448da7';

update public.notification
   set tenant_id = '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164'
 where account_id = 'eb82bf25-046d-4c0b-8e3a-260643448da7';

-- Forces the check HERE rather than at commit, so a mistake in the three
-- statements above fails inside this migration and not silently afterwards.
set constraints all immediate;

alter table public.account enable trigger account_super_admin_guard;

-- ---------------------------------------------------------------------------
-- 2. THE DEFAULT COMES OFF THE 17 CHILD TABLES.
--
-- account and project keep theirs -- no parent, so the caller's tenancy is the
-- only answer there is. Everywhere else the default is not merely unnecessary,
-- it is the bug: it fills the column with the wrong value before any trigger
-- can derive the right one.
-- ---------------------------------------------------------------------------

alter table public.worker                alter column tenant_id drop default;
alter table public.profile               alter column tenant_id drop default;
alter table public.notification          alter column tenant_id drop default;
alter table public.personal_event        alter column tenant_id drop default;
alter table public.personal_event_viewer alter column tenant_id drop default;
alter table public.project_leader        alter column tenant_id drop default;
alter table public.project_day           alter column tenant_id drop default;
alter table public.day_review            alter column tenant_id drop default;
alter table public.arbetsdagbok          alter column tenant_id drop default;
alter table public.pass                  alter column tenant_id drop default;
alter table public.pass_batch            alter column tenant_id drop default;
alter table public.pass_batch_handpick   alter column tenant_id drop default;
alter table public.pass_block            alter column tenant_id drop default;
alter table public.pass_offer            alter column tenant_id drop default;
alter table public.tilldelning           alter column tenant_id drop default;
alter table public.clock_edit            alter column tenant_id drop default;
alter table public.forval                alter column tenant_id drop default;

-- ---------------------------------------------------------------------------
-- 3. ONE FUNCTION, SEVENTEEN TRIGGERS.
--
-- Parameterised rather than seventeen near-identical functions: TG_ARGV[0] is
-- the parent table and TG_ARGV[1] the foreign key column on this row. The
-- parent's key is always `id`, so it does not need naming. The FK value is
-- read out of NEW through to_jsonb because its column name differs per table;
-- tenant_id is assigned directly, because that name is the same on all
-- seventeen.
--
-- SECURITY DEFINER IS LOAD-BEARING, not habit. Without it the parent lookup
-- runs under the caller's own RLS -- and an arbetare inserting a forval row
-- cannot SELECT the worker table for anybody but themselves. The lookup would
-- quietly return NULL, the trigger would leave tenant_id unset, and the insert
-- would die on a not-null constraint that says nothing about why.
--
-- DERIVE, AND REJECT A MISMATCH -- not "fill if null". A caller that sends a
-- tenant_id disagreeing with the parent is making a claim about isolation, and
-- silently overwriting it would hide the attempt. Sending the RIGHT one is
-- accepted, so an explicit writer is never punished for being explicit.
-- ---------------------------------------------------------------------------

create or replace function app.tg_tenant_from_parent() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_parent text := tg_argv[0];
  v_fk_col text := tg_argv[1];
  v_fk     uuid;
  v_tenant uuid;
begin
  v_fk := (to_jsonb(new) ->> v_fk_col)::uuid;

  -- No parent named. The column's own NOT NULL says so better than this can.
  if v_fk is null then return new; end if;

  execute format('select tenant_id from public.%I where id = $1', v_parent)
     into v_tenant using v_fk;

  -- Parent does not exist. The foreign key is about to say so.
  if v_tenant is null then return new; end if;

  if new.tenant_id is not null and new.tenant_id <> v_tenant then
    raise exception
      'tenant_id % does not match the % this row belongs to (%)',
      new.tenant_id, v_parent, v_tenant
      using errcode = 'integrity_constraint_violation';
  end if;

  new.tenant_id := v_tenant;
  return new;
end $fn$;

-- NAMED TO SORT FIRST. Postgres fires BEFORE ROW triggers in alphabetical
-- order, and sixteen guards already sit on these tables. None of them reads
-- tenant_id today, so the order is harmless right now -- but M2 makes the
-- helpers tenant-aware, and a guard that consults the tenant before it has
-- been derived would be a bug nobody would look for. "aa_" is ugly and
-- deterministic, which is the right trade for something that must not depend
-- on a fact that is about to change.

create trigger aa_tenant_from_parent before insert on public.worker
  for each row execute function app.tg_tenant_from_parent('account', 'account_id');
create trigger aa_tenant_from_parent before insert on public.profile
  for each row execute function app.tg_tenant_from_parent('account', 'account_id');
create trigger aa_tenant_from_parent before insert on public.notification
  for each row execute function app.tg_tenant_from_parent('account', 'account_id');
create trigger aa_tenant_from_parent before insert on public.personal_event
  for each row execute function app.tg_tenant_from_parent('account', 'owner_id');

create trigger aa_tenant_from_parent before insert on public.personal_event_viewer
  for each row execute function app.tg_tenant_from_parent('personal_event', 'event_id');

create trigger aa_tenant_from_parent before insert on public.project_leader
  for each row execute function app.tg_tenant_from_parent('project', 'project_id');
create trigger aa_tenant_from_parent before insert on public.project_day
  for each row execute function app.tg_tenant_from_parent('project', 'project_id');
create trigger aa_tenant_from_parent before insert on public.day_review
  for each row execute function app.tg_tenant_from_parent('project', 'project_id');
create trigger aa_tenant_from_parent before insert on public.arbetsdagbok
  for each row execute function app.tg_tenant_from_parent('project', 'project_id');
create trigger aa_tenant_from_parent before insert on public.pass
  for each row execute function app.tg_tenant_from_parent('project', 'project_id');
create trigger aa_tenant_from_parent before insert on public.pass_batch
  for each row execute function app.tg_tenant_from_parent('project', 'project_id');

create trigger aa_tenant_from_parent before insert on public.pass_batch_handpick
  for each row execute function app.tg_tenant_from_parent('pass_batch', 'batch_id');

create trigger aa_tenant_from_parent before insert on public.pass_block
  for each row execute function app.tg_tenant_from_parent('pass', 'pass_id');
create trigger aa_tenant_from_parent before insert on public.pass_offer
  for each row execute function app.tg_tenant_from_parent('pass', 'pass_id');
create trigger aa_tenant_from_parent before insert on public.tilldelning
  for each row execute function app.tg_tenant_from_parent('pass', 'pass_id');

create trigger aa_tenant_from_parent before insert on public.clock_edit
  for each row execute function app.tg_tenant_from_parent('tilldelning', 'tilldelning_id');

create trigger aa_tenant_from_parent before insert on public.forval
  for each row execute function app.tg_tenant_from_parent('worker', 'worker_id');

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
