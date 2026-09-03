-- Clear demo/walkthrough data, keeping every admin account.
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
alter table public.pass          disable trigger pass_delete_guard;
alter table public.tilldelning   disable trigger assignment_write_guard;
alter table public.project_day   disable trigger confirmation_guard;
alter table public.account       disable trigger last_admin_guard;

delete from public.clock_edit;
delete from public.tilldelning;
delete from public.pass_offer;
delete from public.pass_block;
delete from public.pass;
delete from public.pass_batch_handpick;
delete from public.pass_batch;
delete from public.project_day;
delete from public.arbetsdagbok;
delete from public.project_leader;
delete from public.notification;
delete from public.forval;
delete from public.project;
delete from public.worker;
delete from public.account where role <> 'admin';
delete from auth.users u where not exists (
  select 1 from public.account a where a.id = u.id
);

alter table public.pass          enable trigger pass_delete_guard;
alter table public.tilldelning   enable trigger assignment_write_guard;
alter table public.project_day   enable trigger confirmation_guard;
alter table public.account       enable trigger last_admin_guard;
