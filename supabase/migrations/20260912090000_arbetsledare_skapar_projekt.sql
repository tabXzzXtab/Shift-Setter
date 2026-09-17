-- ============================================================================
-- ARBETSLEDAREN SKAPAR PROJEKT
--
-- Section 2 read "Cannot: create projects" for the arbetsledare, and named the
-- admin as "the only role that can ... assign arbetsledare to a project".
-- Both move here: a leader creates a project and names the arbetsledare
-- responsible for it, which may be somebody other than themselves.
--
-- WHAT DOES NOT MOVE. Redigera Projekt and Ta bort projekt stay the admin's.
-- project_admin_write was a single FOR ALL policy, so opening creation means
-- splitting insert away from update rather than widening the one policy --
-- otherwise "a leader may create a project" would silently read as "a leader
-- may rewrite any project they lead", which is a different decision and was
-- not the one made. public.delete_project() keeps its is_admin() refusal
-- untouched.
--
-- THE CREATOR GOES ON THE PROJECT TOO. project_staff_select is leads_project()
-- and holds_a_day(), so a leader who hands a project to a colleague would lose
-- sight of it the instant they submitted the form -- gone from Alla Projekt,
-- gone from the Skapa Pass picker, no way to check the thing they had just
-- made. Two project_leader rows go in: the named leader and the person who
-- made it. A project may have several leaders already (Section 2), and
-- invariant 4b decides which of them answers for a given DAY from the
-- arbetsledare row on it, not from membership -- so a second leader on the
-- project does not make two people responsible for the same day.
--
-- WHAT THIS DOES NOT TOUCH. Invariant 4b, app.confirms_project(), and the rule
-- that the admin cannot make a stage 1 confirmation are all unchanged. This
-- migration decides who may CREATE the scope, never who confirms inside it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WHO MADE THIS PROJECT
--
-- created_by has existed since the initial schema and nothing has ever written
-- it: the client never sent it and every row in the live database carries
-- null. From here it is load-bearing -- section 4 keys the right to name a
-- project's leaders on it -- so it can no longer be a column the caller
-- supplies. A DEFAULT would still let a client pass its own value and claim a
-- project somebody else made.
--
-- The guard is skipped when auth.uid() is null, which is the database owner
-- applying schema, seeding demo data or running the suite. Nothing there is a
-- client, and RLS does not apply to those writes either.
--
-- On UPDATE it raises rather than pinning silently. An admin editing a project
-- has no reason to move its authorship, and a column that decides who may
-- write elsewhere should say so when something tries.
-- ---------------------------------------------------------------------------
create or replace function app.tg_project_created_by() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new.created_by := (select auth.uid());
    end if;
    return new;
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'a project records who created it; that cannot be changed'
      using errcode = 'check_violation';
  end if;

  return new;
end $fn$;

create trigger project_created_by
  before insert or update on public.project
  for each row execute function app.tg_project_created_by();

-- ---------------------------------------------------------------------------
-- 2. A PROJECT YOU MADE IS A PROJECT YOU CAN READ
--
-- Not a convenience. PostgREST inserts with RETURNING, and RLS re-applies the
-- SELECT policy to the row an INSERT produces -- the same mechanism that makes
-- public.delete_pass() necessary, met from the other side. At the instant the
-- project row lands there is no project_leader row yet, so leads_project() is
-- false and the creator would get back nothing: no id to attach the leaders
-- to, and a form that reports failure over a project that was created.
--
-- It also survives the two-statement window. The leader rows go in as a second
-- statement, and between them the project is visible to its creator alone.
--
-- THE POLICY TESTS THE COLUMN; IT DOES NOT CALL app.created_project(). The
-- helper below is STABLE and re-reads public.project, and a STABLE function
-- sees the snapshot the command started with -- which does not contain the row
-- that command is inserting. A policy written that way passes every ordinary
-- SELECT and fails the one case it exists for: "new row violates row-level
-- security policy for table project", on the RETURNING clause, on the exact
-- statement the client sends. A policy expression already has the new row's
-- columns in hand, so created_by is read from the row instead of looked up.
-- (Found by LEDPROJ.insert_returns_the_row, which is why that assertion goes
-- through RETURNING rather than counting rows afterwards.)
--
-- The helper stays for section 4, where the lookup is unavoidable: that policy
-- is on a different table and the project it asks about was inserted by an
-- earlier statement, so it is in the snapshot.
-- ---------------------------------------------------------------------------
create or replace function app.created_project(p_project uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.project p
    where p.id = p_project
      and p.deleted_at is null              -- INVARIANT 8
      and p.created_by = (select auth.uid())
  )
$$;

grant execute on function app.created_project(uuid) to authenticated;

drop policy if exists project_staff_select on public.project;
create policy project_staff_select on public.project for select
  using (
    deleted_at is null
    and (app.leads_project(id) or app.holds_a_day(id)
         or created_by = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 3. INSERT, AND ONLY INSERT
--
-- project_admin_write stays exactly as it is: FOR ALL, admin, deleted_at is
-- null. This is a second permissive policy beside it, and a permissive policy
-- can only ever add. A leader gets INSERT and nothing else -- no UPDATE, no
-- route to deleted_at, and public.delete_project() still refuses anybody who
-- is not an admin.
--
-- Invariant 7 needs no help here. Every field the Arbetsdagbok prints is NOT
-- NULL with a non-blank check on the table, so a leader's insert is refused on
-- the same grounds an admin's is.
-- ---------------------------------------------------------------------------
create policy project_staff_insert on public.project
  for insert to authenticated
  with check (app.is_staff() and deleted_at is null);

-- ---------------------------------------------------------------------------
-- 4. NAMING THE LEADERS
--
-- Scoped to projects the caller CREATED, not to projects they lead. A leader
-- the admin put on an existing site may not quietly add a colleague to it;
-- what they may do is say who is responsible for a project they are making.
-- That is the whole of the change, and created_by is what makes it a boundary
-- the database can check.
--
-- INSERT only. Removing a leader stays with project_leader_admin_write, so
-- naming the wrong person is a call to the admin rather than something the
-- creator quietly re-does.
-- ---------------------------------------------------------------------------
create policy project_leader_creator_insert on public.project_leader
  for insert to authenticated
  with check (app.is_staff() and app.created_project(project_id));

-- ---------------------------------------------------------------------------
-- 5. THE PERSON NAMED MUST BE AN ARBETSLEDARE
--
-- Until now this table was written by admins alone and the role was enforced
-- by the picker -- account_directory filtered to role = 'arbetsledare' and
-- nothing else was ever offered. A client-side filter is decorative
-- (CLAUDE.md), and section 4 above just handed the table a second writer, so
-- the rule moves into the database where it should always have been.
--
-- Two holes close, and neither is hypothetical:
--
--   AN ARBETARE. app.confirms_project() is pure membership of this table. A
--   worker's account id in it would make them able to confirm a day -- writing
--   hours and confirmation state, which invariant 4 says an arbetare never
--   does -- and app.sync_leader_day() would auto-place them as the day's
--   'ledare' row, since it joins project_leader on nothing but an active
--   account and a worker record.
--
--   AN ADMIN. The same membership test is what "the admin cannot make a stage
--   1 confirmation" rests on: app.confirms_project() deliberately does NOT
--   fall back to is_admin(), but it never checked that a member was not one.
--   An admin row here would have given the owner the one claim the system
--   exists to keep away from him. An admin needs no row in any case --
--   app.leads_project() already admits them everywhere.
--
-- The live table holds arbetsledare rows only, so nothing existing contradicts
-- this.
-- ---------------------------------------------------------------------------
create or replace function app.tg_project_leader_is_a_leader() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_role public.app_role;
begin
  select a.role into v_role from public.account a where a.id = new.account_id;

  -- NULL is a denial (CLAUDE.md): a missing account is not an arbetsledare,
  -- and "is distinct from" is what makes that a refusal instead of a NULL.
  if v_role is distinct from 'arbetsledare' then
    raise exception 'only an arbetsledare can be responsible for a project'
      using errcode = 'check_violation';
  end if;

  return new;
end $fn$;

create trigger project_leader_is_a_leader
  before insert or update on public.project_leader
  for each row execute function app.tg_project_leader_is_a_leader();

-- ---------------------------------------------------------------------------
-- 6. THE PICKER NEEDS A LIST
--
-- account_directory ends in "where app.is_admin() or a.id = auth.uid()", so an
-- arbetsledare reading it sees exactly one row: themselves. The form that asks
-- them to choose who is responsible would offer their own name and nothing
-- else, and the half of this change about naming somebody ELSE would not
-- exist.
--
-- A view rather than a widened account_directory, for the reason worker_roster
-- is a view: RLS is row-level and the rule here is column-level. Every logged
-- in user is the same database role, so a grant cannot hand a leader the name
-- while keeping the email -- and account_directory carries email, which
-- Section 3 keeps between a person and the admin. Names for scheduling, and
-- nothing else, exactly as worker_roster does it for workers.
--
-- The name falls back the way account_directory's does: an arbetsledare who
-- never works shifts has no worker record (Section 3), and their name lives in
-- auth.users. Without the fallback those leaders would be unnameable in the
-- one screen that has to name them.
--
-- Paused accounts are out. Someone who cannot log in cannot confirm a day, and
-- a project handed to them would have to be repaired by the admin before it
-- could ever produce a document.
-- ---------------------------------------------------------------------------
create view public.arbetsledare_roster with (security_invoker = false) as
select
  a.id,
  coalesce(w.name, u.raw_user_meta_data->>'name') as name
from public.account a
left join public.worker w on w.account_id = a.id and w.deleted_at is null
left join auth.users u on u.id = a.id
where a.role = 'arbetsledare'
  and a.active
  and app.is_staff();

grant select on public.arbetsledare_roster to authenticated;
