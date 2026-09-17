-- Clear every project and every shift, keeping the people.
--
-- Accounts, workers, profiles, personal events and forval (a worker's own
-- availability, which is keyed on worker+date and belongs to no project) are
-- untouched. Logins keep working.
--
-- tilldelning.project_id is ON DELETE NO ACTION, so assignments must go before
-- projects or the delete raises. Everything else cascades from project/pass.
--
-- Guards refuse hard deletes on purpose (shifts are soft-deleted; confirmed
-- days are final). Stood down for this statement and put straight back, in one
-- transaction. The application has no route to this.
alter table public.pass        disable trigger pass_delete_guard;
alter table public.tilldelning disable trigger assignment_write_guard;
alter table public.project_day disable trigger confirmation_guard;

delete from public.clock_edit;
delete from public.tilldelning;
delete from public.pass_offer;
delete from public.pass_block;
delete from public.pass;
delete from public.pass_batch_handpick;
delete from public.pass_batch;
delete from public.day_review;
delete from public.project_day;
delete from public.arbetsdagbok;
delete from public.project_leader;
delete from public.project;

alter table public.pass        enable trigger pass_delete_guard;
alter table public.tilldelning enable trigger assignment_write_guard;
alter table public.project_day enable trigger confirmation_guard;
