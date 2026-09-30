-- Clear demo/walkthrough data in BELLA SERVICE AB's tenancy, keeping every
-- admin account.
--
-- SCOPED TO ONE TENANCY, and this file used to not be. Every statement below
-- ran without a WHERE clause, so a reset meant to clear demo data emptied
-- EVERY company in the database: workers, projects, passes, förval,
-- notifications, confirmed days, arbetsdagböcker, personal events, profiles
-- and all non-admin accounts, in every tenancy there was. The cost was written
-- down in CLAUDE.md and the step was made mandatory anyway.
--
-- On 30 Sep it destroyed a third tenancy's data -- its workers, its projects,
-- its profile and two of its three accounts. That one was a typo tenancy
-- somebody had already decided to delete, which was luck and not a defence:
-- the same run would have done the same to a real customer. Multi-tenancy
-- arrived and this file did not notice.
--
-- The lookup is by NAME and fails loudly if it matches nothing. A subquery
-- returning NULL would make every `tenant_id = NULL` match no rows and the
-- whole reset a silent no-op, which is the safe direction to fail but a
-- confusing one to debug.
--
-- This DELETES the arbetsledare and arbetare logins too, so anyone holding a
-- handed-out login loses it. Use `npm run demo:reset`, which runs this and then
-- recreates the stable demo accounts; running this file alone leaves the demo
-- with an admin and nobody else.
--
-- Keyed on role, not on an email address: this repository is public, and the
-- founding admin's login identifier is half of a credential.
--
-- Guards refuse hard deletes on purpose (shifts are soft-deleted; confirmed
-- days are final). They are stood down for this maintenance statement and put
-- straight back, in one transaction. The application has no route to this.

-- The one tenancy this file may touch, resolved once and checked.
create temp table _demo_tenant as
  select id from public.tenant where name = 'Bella Service AB';

do $$
begin
  if (select count(*) from _demo_tenant) <> 1 then
    raise exception 'reset-demo-data: expected exactly one tenancy named '
                    '"Bella Service AB", found %', (select count(*) from _demo_tenant);
  end if;
end $$;

-- WHOSE LOGINS GO, decided BEFORE anything is deleted. The old file finished by
-- removing every auth.users row with no account behind it, which is another
-- tenant-blind statement: an orphaned login belonging to somebody else would go
-- with it. Naming them up front means only this tenancy's non-admins are
-- touched, and the auth rows are matched by id rather than by absence.
create temp table _demo_logins as
  select a.id
    from public.account a, _demo_tenant t
   where a.tenant_id = t.id and a.role <> 'admin';

alter table public.pass          disable trigger pass_delete_guard;
alter table public.tilldelning   disable trigger assignment_write_guard;
alter table public.project_day   disable trigger confirmation_guard;
alter table public.account       disable trigger last_admin_guard;

delete from public.clock_edit            where tenant_id in (select id from _demo_tenant);
delete from public.tilldelning           where tenant_id in (select id from _demo_tenant);
delete from public.pass_offer            where tenant_id in (select id from _demo_tenant);
delete from public.pass_block            where tenant_id in (select id from _demo_tenant);
delete from public.pass                  where tenant_id in (select id from _demo_tenant);
delete from public.pass_batch_handpick   where tenant_id in (select id from _demo_tenant);
delete from public.pass_batch            where tenant_id in (select id from _demo_tenant);
delete from public.day_review            where tenant_id in (select id from _demo_tenant);
delete from public.project_day           where tenant_id in (select id from _demo_tenant);
delete from public.arbetsdagbok          where tenant_id in (select id from _demo_tenant);
delete from public.project_leader        where tenant_id in (select id from _demo_tenant);
delete from public.notification          where tenant_id in (select id from _demo_tenant);
delete from public.forval                where tenant_id in (select id from _demo_tenant);
delete from public.project               where tenant_id in (select id from _demo_tenant);
delete from public.worker                where tenant_id in (select id from _demo_tenant);
-- CASCADE from account only reaches rows owned by the accounts being deleted,
-- so an ADMIN's personal event or profile row survives the wipe unless it is
-- named here. Both are content, not credentials.
delete from public.personal_event_viewer where tenant_id in (select id from _demo_tenant);
delete from public.personal_event        where tenant_id in (select id from _demo_tenant);
delete from public.profile               where tenant_id in (select id from _demo_tenant);
delete from public.account               where id in (select id from _demo_logins);
delete from auth.users                   where id in (select id from _demo_logins);

alter table public.pass          enable trigger pass_delete_guard;
alter table public.tilldelning   enable trigger assignment_write_guard;
alter table public.project_day   enable trigger confirmation_guard;
alter table public.account       enable trigger last_admin_guard;

drop table _demo_logins;
drop table _demo_tenant;
