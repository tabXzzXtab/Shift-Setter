-- ============================================================================
-- M1 -- MULTI-TENANCY, STRUCTURE ONLY.
--
-- This migration changes NO BEHAVIOUR. It adds the tenant table, creates the
-- two tenants that exist on day one -- Korperation, which owns ByggKoll, and
-- Bella Service AB, which is its first customer -- puts a NOT NULL tenant_id
-- on all 19 RLS tables, and defines app.current_tenant_id().
--
-- The client gets every operational row; Korperation gets the admin accounts
-- and nothing else.
--
-- NOT ONE POLICY IS TOUCHED. Nothing calls current_tenant_id() when this
-- migration finishes; it is defined and inert. That is the point of the split:
-- M2 rewrites 34 policies and 26 SECURITY DEFINER functions and can take the
-- app down for every user if one of them is wrong, and when that happens the
-- thing to revert is M2 alone. Structure and enforcement in one migration is a
-- revert that also drops the columns.
--
-- M2 adds the tenant clause to every policy and every RPC.
-- M3 adds expiry to current_tenant_id(), scopes the last-admin guard to the
--    tenant, and adds the Swedish lockout message to src/lib/fel.ts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The tenant.
-- ---------------------------------------------------------------------------

-- An enum, not a CHECK: this schema has eight of them and nothing of this
-- shape as a text constraint. 'owner' is the one value not in the brief --
-- see the founding tenant below for why it is here.
create type public.tenant_account_type as enum ('demo', 'sold', 'gift', 'owner');

create table public.tenant (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  org_nr        text not null,
  account_type  public.tenant_account_type not null,
  created_at    timestamptz not null default now(),

  -- Null means "does not expire". A demo must carry one; the other three
  -- kinds may, and a sold tenant that stops paying is expressed by setting it
  -- rather than by deleting anything.
  expires_at    timestamptz,
  invoice_email text,

  constraint tenant_name_not_blank   check (btrim(name) <> ''),
  constraint tenant_org_nr_not_blank check (btrim(org_nr) <> ''),

  -- The three-week demo is the whole reason expires_at exists. A demo without
  -- one is a free account forever, created by a slip nobody would notice.
  constraint tenant_demo_expires
    check (account_type <> 'demo' or expires_at is not null)
);

-- RLS ON, NO POLICY, NO GRANT -- which denies every logged-in user outright.
-- That is the correct M1 state: nothing in the app reads this table yet, and
-- an accidental read returning rows would be worse than one returning none.
-- M2 adds the policy that lets a member read their own tenant row.
alter table public.tenant enable row level security;

-- ---------------------------------------------------------------------------
-- The founding tenant, and the columns that point at it.
-- ---------------------------------------------------------------------------

-- THE SUPER ADMIN, AND THE HOLE IT WOULD OTHERWISE OPEN.
--
-- Korperation's own staff sit above every tenant: they create them on the
-- onboarding page and have to support them afterwards. The flag short-circuits
-- the tenant clause in M2 rather than making tenant_id nullable, so every
-- account still has a home tenant and "which tenant is this person in" never
-- has a second answer.
--
-- IT MUST BE GUARDED THE MOMENT IT EXISTS, not in M2. account_admin_write is
-- ALL USING(is_admin()) CHECK(is_admin()) -- any admin may UPDATE any account
-- row. Add this column unguarded and every tenant admin can set it on
-- themselves, so the flag is self-service from the instant M2 gives it
-- meaning. The two triggers at the foot of this file are what stop that, and
-- they ship in the same migration as the column deliberately.
alter table public.account add column super_admin boolean not null default false;

-- THE ID IS PINNED, not generated. A column default has to name this row as a
-- literal (see below), and a default cannot call a subquery -- so the value
-- has to exist in the text of the migration rather than be discovered at run
-- time. One writer applies this once; a fixed uuid is as safe here as it is
-- unusual elsewhere.
insert into public.tenant (id, name, org_nr, account_type, expires_at)
values (
  '7b3e1c42-9d5a-4f68-b0e7-2a6c8f14d903',
  'Korperation',
  '041104-7756',
  -- 'owner' rather than 'gift'. A gift is something given away, and counting
  -- gifts handed out should not count yourself; 'sold' would put the company
  -- in its own revenue. If a fourth value is unwanted this becomes 'gift',
  -- with that caveat.
  'owner',
  null  -- the owner's own tenancy does not expire
);

-- THE CLIENT, AND THE OWNER OF EVERY ROW ALREADY IN THIS DATABASE.
--
-- Bella Service AB is ByggKoll's first customer, not its vendor. Every
-- project, pass, worker, forval and Arbetsdagbok in here is theirs, and it
-- backfills to THIS tenant rather than to Korperation -- otherwise onboarding
-- them later would hand them an empty tenancy with their own history stranded
-- inside somebody else's.
--
-- 'sold' rather than 'demo': a paying customer, and the tenancy does not
-- expire. invoice_email stays null until the onboarding page collects one.
insert into public.tenant (id, name, org_nr, account_type, expires_at)
values ('2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164', 'Bella Service AB', '556788-2369', 'sold', null);

-- ---------------------------------------------------------------------------
-- tenant_id on the remaining 18, all nullable for now.
-- ---------------------------------------------------------------------------

-- NOT NULL WITH A DEFAULT, AND NO UPDATE ANYWHERE. This is the whole reason
-- the block that used to sit below this one is gone.
--
-- The backfill was 19 UPDATE statements, and an UPDATE fires this schema's
-- guard triggers. It does not matter that only tenant_id moved: the first dry
-- run died on app.tg_confirmation_guard -- "day 2026-09-16 is confirmed;
-- stage 1 is final" -- because invariant 5 refuses to let anything edit a
-- confirmed project_day, and a migration touching a column it has never heard
-- of is still an edit. Fifteen guards sit on these tables (pass_edit_guard,
-- assignment_write_guard, no_overlapping_assignment, worker_self_edit_guard
-- and the rest) and the backfill would have walked into them one after
-- another.
--
-- The alternative was to disable triggers around the backfill, which means a
-- migration that switches off invariants 2, 3, 4 and 5 and switches them back
-- on -- and is wrong if it ever fails in between.
--
-- ADD COLUMN ... NOT NULL DEFAULT <literal> needs none of that. Since
-- Postgres 11 it writes the default into the catalogue and existing rows read
-- it from there: no rows are rewritten, no UPDATE is issued, and no trigger
-- fires. It is also instant on a table of any size. The default is dropped at
-- the foot of this section. THE DEFAULT NAMES BELLA SERVICE AB, not the
-- founding tenant: Korperation owns the product, but every row already in this
-- database belongs to the client.

alter table public.account               add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.worker                add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.profile               add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.project               add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.project_leader        add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.project_day           add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.pass                  add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.pass_batch            add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.pass_batch_handpick   add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.pass_block            add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.pass_offer            add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.tilldelning           add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.forval                add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.clock_edit            add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.day_review            add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.arbetsdagbok          add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.notification          add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.personal_event        add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);
alter table public.personal_event_viewer add column tenant_id uuid not null default '2f9a6d15-4c83-4e71-9a2b-5d07e3b8c164' references public.tenant (id);

-- ---------------------------------------------------------------------------
-- Backfill.
--
-- OPEN QUESTION, AND THE REASON THIS BLOCK IS NOT FINISHED.
--
-- Every row in this database today is Bella Service AB's: their projects,
-- their workers, their passes, their generated Arbetsdagbok documents. But the
-- founding tenant is Korperation, the company that OWNS ByggKoll, and Bella
-- Service AB is to be onboarded as an ordinary client once the onboarding page
-- exists.
--
-- So sending everything to the founding tenant puts a customer's operational
-- record inside the vendor's tenancy, and onboarding them later hands them a
-- fresh empty tenant with their own history stranded behind them. The two
-- companies are not the same tenant and the data cannot be backfilled as if
-- they were.
--
-- What this almost certainly wants is TWO rows in public.tenant from the
-- start -- Korperation as 'owner' holding the super admins and no operational
-- data, and Bella Service AB as a client holding all of it -- with the
-- accounts split between them. Which existing accounts are Korperation's
-- rather than Bella Service AB's is not something the schema can answer.
--
-- Until that is settled this block sends everything to Korperation, which is
-- WRONG and is here only so the migration can be dry-run end to end.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- THE ADMINS ARE KORPERATION'S. EVERYTHING ELSE IS THE CLIENT'S.
--
-- Every account holding role = 'admin' today is Korperation staff -- they are
-- the people who run ByggKoll -- and every arbetsledare and arbetare is Bella
-- Service AB's. The columns above have already put all 19 tables in the
-- client's tenancy, so this moves the three admins back out of it.
--
-- Written as role = 'admin' rather than three pinned ids because that IS the
-- rule, and a rule is legible where a list of uuids is not. It runs once, at a
-- moment when those are exactly the three accounts that exist.
--
-- THE COMPOSITE KEYS DECIDE WHAT TRAVELS WITH THEM, which is why this is five
-- statements and not one: a profile, a personal_event, an event's viewer rows
-- and a notification each carry a key demanding they agree with their account's
-- tenant, so a moved account with a stranded profile fails at the constraints
-- further down this file rather than at some later read.
--
-- It is safe against the guards that killed the first version of this
-- migration. app.tg_last_admin_guard returns early while the row stays an
-- active admin, which it does -- neither role nor active moves here.
-- tg_account_pause and tg_account_unpause watch `active` and do not fire. And
-- it must run BEFORE the two super_admin triggers at the foot of this file
-- exist: they refuse a caller who is not already a super admin, and a
-- migration has no auth.uid() at all.
--
-- Checked against the data before it was written: no admin holds a
-- project_leader or tilldelning row, and no personal_event crosses the line in
-- either direction. A Korperation admin leading a Bella Service AB project
-- would violate two composite keys at once and simply could not be
-- represented; it does not occur.
-- ---------------------------------------------------------------------------

update public.account
   set tenant_id = '7b3e1c42-9d5a-4f68-b0e7-2a6c8f14d903', super_admin = true
 where role = 'admin';

update public.profile p
   set tenant_id = '7b3e1c42-9d5a-4f68-b0e7-2a6c8f14d903'
  from public.account a
 where a.id = p.account_id and a.role = 'admin';

update public.personal_event e
   set tenant_id = '7b3e1c42-9d5a-4f68-b0e7-2a6c8f14d903'
  from public.account a
 where a.id = e.owner_id and a.role = 'admin';

-- After the events have moved, so this reads the new value rather than
-- re-deriving who owns what.
update public.personal_event_viewer v
   set tenant_id = '7b3e1c42-9d5a-4f68-b0e7-2a6c8f14d903'
  from public.personal_event e
 where e.id = v.event_id and e.tenant_id = '7b3e1c42-9d5a-4f68-b0e7-2a6c8f14d903';

update public.notification n
   set tenant_id = '7b3e1c42-9d5a-4f68-b0e7-2a6c8f14d903'
  from public.account a
 where a.id = n.account_id and a.role = 'admin';


-- ---------------------------------------------------------------------------
-- The defaults come off.
-- ---------------------------------------------------------------------------

-- The default has done its work. Taking it off means an INSERT that forgets
-- tenant_id now fails loudly instead of quietly joining Korperation.
alter table public.account               alter column tenant_id drop default;
alter table public.worker                alter column tenant_id drop default;
alter table public.profile               alter column tenant_id drop default;
alter table public.project               alter column tenant_id drop default;
alter table public.project_leader        alter column tenant_id drop default;
alter table public.project_day           alter column tenant_id drop default;
alter table public.pass                  alter column tenant_id drop default;
alter table public.pass_batch            alter column tenant_id drop default;
alter table public.pass_batch_handpick   alter column tenant_id drop default;
alter table public.pass_block            alter column tenant_id drop default;
alter table public.pass_offer            alter column tenant_id drop default;
alter table public.tilldelning           alter column tenant_id drop default;
alter table public.forval                alter column tenant_id drop default;
alter table public.clock_edit            alter column tenant_id drop default;
alter table public.day_review            alter column tenant_id drop default;
alter table public.arbetsdagbok          alter column tenant_id drop default;
alter table public.notification          alter column tenant_id drop default;
alter table public.personal_event        alter column tenant_id drop default;
alter table public.personal_event_viewer alter column tenant_id drop default;

-- ---------------------------------------------------------------------------
-- A CHILD CANNOT LEAVE ITS PARENT'S TENANT.
--
-- Composite foreign keys rather than triggers. A pass whose project belongs to
-- another tenant is then unrepresentable rather than merely refused by
-- something that has to be remembered and run -- and it is the database saying
-- so, which is the only boundary this architecture has.
--
-- Each one needs the parent unique on (id, tenant_id). That is redundant with
-- the primary key and exists only so the composite key has something to point
-- at: an index per parent, buying a guarantee no policy has to restate.
-- ---------------------------------------------------------------------------

alter table public.account        add constraint account_id_tenant_key        unique (id, tenant_id);
alter table public.worker         add constraint worker_id_tenant_key         unique (id, tenant_id);
alter table public.project        add constraint project_id_tenant_key        unique (id, tenant_id);
alter table public.pass           add constraint pass_id_tenant_key           unique (id, tenant_id);
alter table public.pass_batch     add constraint pass_batch_id_tenant_key     unique (id, tenant_id);
alter table public.tilldelning    add constraint tilldelning_id_tenant_key    unique (id, tenant_id);
alter table public.personal_event add constraint personal_event_id_tenant_key unique (id, tenant_id);

alter table public.worker add constraint worker_tenant_matches_account
  foreign key (account_id, tenant_id) references public.account (id, tenant_id);
alter table public.profile add constraint profile_tenant_matches_account
  foreign key (account_id, tenant_id) references public.account (id, tenant_id);
alter table public.notification add constraint notification_tenant_matches_account
  foreign key (account_id, tenant_id) references public.account (id, tenant_id);

alter table public.project_leader add constraint project_leader_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id);
alter table public.project_leader add constraint project_leader_tenant_matches_account
  foreign key (account_id, tenant_id) references public.account (id, tenant_id);
alter table public.project_day add constraint project_day_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id);
alter table public.day_review add constraint day_review_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id);
alter table public.arbetsdagbok add constraint arbetsdagbok_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id);
alter table public.pass add constraint pass_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id);
alter table public.pass_batch add constraint pass_batch_tenant_matches_project
  foreign key (project_id, tenant_id) references public.project (id, tenant_id);

alter table public.pass_batch_handpick add constraint handpick_tenant_matches_batch
  foreign key (batch_id, tenant_id) references public.pass_batch (id, tenant_id);
alter table public.pass_batch_handpick add constraint handpick_tenant_matches_worker
  foreign key (worker_id, tenant_id) references public.worker (id, tenant_id);
alter table public.pass_block add constraint pass_block_tenant_matches_pass
  foreign key (pass_id, tenant_id) references public.pass (id, tenant_id);
alter table public.pass_block add constraint pass_block_tenant_matches_worker
  foreign key (worker_id, tenant_id) references public.worker (id, tenant_id);
alter table public.pass_offer add constraint pass_offer_tenant_matches_pass
  foreign key (pass_id, tenant_id) references public.pass (id, tenant_id);
alter table public.pass_offer add constraint pass_offer_tenant_matches_worker
  foreign key (worker_id, tenant_id) references public.worker (id, tenant_id);
alter table public.tilldelning add constraint tilldelning_tenant_matches_pass
  foreign key (pass_id, tenant_id) references public.pass (id, tenant_id);
alter table public.forval add constraint forval_tenant_matches_worker
  foreign key (worker_id, tenant_id) references public.worker (id, tenant_id);
alter table public.clock_edit add constraint clock_edit_tenant_matches_tilldelning
  foreign key (tilldelning_id, tenant_id) references public.tilldelning (id, tenant_id);
-- Found while working out what has to travel with an account that changes
-- tenant: personal_event.owner_id pointed at account with no agreement about
-- tenant, so an event could outlive its owner's tenancy. The viewer table had
-- this constraint and the event table did not.
alter table public.personal_event add constraint personal_event_tenant_matches_owner
  foreign key (owner_id, tenant_id) references public.account (id, tenant_id);
alter table public.personal_event_viewer add constraint pev_tenant_matches_event
  foreign key (event_id, tenant_id) references public.personal_event (id, tenant_id);
alter table public.personal_event_viewer add constraint pev_tenant_matches_account
  foreign key (account_id, tenant_id) references public.account (id, tenant_id);

-- Every policy in M2 filters on this column, so every table gets an index on
-- it. Without one the tenant clause is a sequential scan on every read.
create index account_tenant               on public.account               (tenant_id);
create index worker_tenant                on public.worker                (tenant_id);
create index profile_tenant               on public.profile               (tenant_id);
create index project_tenant               on public.project               (tenant_id);
create index project_leader_tenant        on public.project_leader        (tenant_id);
create index project_day_tenant           on public.project_day           (tenant_id);
create index pass_tenant                  on public.pass                  (tenant_id);
create index pass_batch_tenant            on public.pass_batch            (tenant_id);
create index pass_batch_handpick_tenant   on public.pass_batch_handpick   (tenant_id);
create index pass_block_tenant            on public.pass_block            (tenant_id);
create index pass_offer_tenant            on public.pass_offer            (tenant_id);
create index tilldelning_tenant           on public.tilldelning           (tenant_id);
create index forval_tenant                on public.forval                (tenant_id);
create index clock_edit_tenant            on public.clock_edit            (tenant_id);
create index day_review_tenant            on public.day_review            (tenant_id);
create index arbetsdagbok_tenant          on public.arbetsdagbok          (tenant_id);
create index notification_tenant          on public.notification          (tenant_id);
create index personal_event_tenant        on public.personal_event        (tenant_id);
create index personal_event_viewer_tenant on public.personal_event_viewer (tenant_id);

-- ---------------------------------------------------------------------------
-- Who the caller is, tenant-wise.
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER AND STABLE, modelled on app.current_role() exactly.
--
-- It must be SECURITY DEFINER or M2 deadlocks on itself: the account SELECT
-- policy will read "tenant_id = app.current_tenant_id()", and this function
-- reads account. A non-definer function would re-enter that policy and recurse
-- forever. Definer runs as the owner, RLS does not apply, and the recursion
-- never starts. It is the same reason current_role() is written this way.
--
-- NULL FOR A MISSING OR PAUSED ACCOUNT, and that is a denial everywhere it is
-- used rather than an omission. "tenant_id = NULL" is NULL: a SELECT filters
-- to zero rows and a WITH CHECK refuses. Gotcha 3 in CLAUDE.md is about guards
-- that rely on a three-valued result being read as false by an IF -- this is
-- the other case, where NULL propagating through a comparison is exactly the
-- behaviour wanted. M3 adds the expiry clause here, which is what turns a
-- lapsed demo into the same NULL.
create or replace function app.current_tenant_id() returns uuid
  language sql stable security definer
  set search_path = ''
as $$
  select a.tenant_id from public.account a
  where a.id = (select auth.uid()) and a.active
$$;

-- Same shape as app.is_admin(): coalesced, because a null is a denial.
create or replace function app.is_super_admin() returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(
    (select a.super_admin from public.account a
      where a.id = (select auth.uid()) and a.active),
    false)
$$;

-- ---------------------------------------------------------------------------
-- super_admin is not self-service.
-- ---------------------------------------------------------------------------

-- ONLY A SUPER ADMIN MAY GRANT OR REVOKE IT, and nobody may do either to
-- themselves. Without this, account_admin_write lets any tenant's admin
-- promote themselves the moment M2 gives the flag meaning. A trigger rather
-- than a column grant for the reason CLAUDE.md gives: every logged-in user is
-- the same database role, so a grant restricting a customer's admin restricts
-- ours identically.
--
-- The founding super admins are set by the backfill above, which runs before
-- this trigger exists -- the same single-writer route the founding admin
-- itself came in on.
create or replace function app.tg_super_admin_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  if new.super_admin is distinct from old.super_admin then
    if not app.is_super_admin() then
      raise exception 'only a super admin can grant or revoke super admin'
        using errcode = 'insufficient_privilege';
    end if;
    if new.id = (select auth.uid()) then
      raise exception 'super admin cannot be changed on your own account'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $fn$;

create trigger account_super_admin_guard
  before update on public.account
  for each row execute function app.tg_super_admin_guard();

-- A NEW ACCOUNT CANNOT ARRIVE ALREADY PROMOTED. The trigger above compares OLD
-- and NEW and so never fires on INSERT, and create-account inserts the row --
-- an INSERT carrying super_admin = true would walk straight past it.
create or replace function app.tg_super_admin_insert_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  if new.super_admin and not app.is_super_admin() then
    raise exception 'only a super admin can create a super admin'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $fn$;

create trigger account_super_admin_insert_guard
  before insert on public.account
  for each row execute function app.tg_super_admin_insert_guard();

-- No grants on public.tenant: M2 introduces the read. The app schema is
-- re-granted the way every migration that adds a function there does it.
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
