-- ============================================================================
-- M2a -- EVERY POLICY CARRIES THE TENANT.
--
-- Thirty-four policies, nineteen tables, plus a first policy for public.tenant
-- itself. Until now tenant_id has been structural only: M1 put the column on,
-- M1c made every child derive it from its parent, and nothing read it. This is
-- where it starts deciding what people can see.
--
-- GENERATED FROM THE LIVE CATALOGUE, not retyped. Each policy's existing
-- expression is taken verbatim from pg_policy and wrapped, so this migration
-- cannot quietly drop a clause somebody added since the last time anyone read
-- the file. What changes is one predicate per policy and nothing else.
--
-- THE SHAPE, everywhere:
--
--   using      (app.in_tenant(tenant_id) and (<what was there>))
--   with check (app.in_tenant(tenant_id) and (<what was there>))
--
-- app.in_tenant() is true for a row in the caller's own tenancy, and true for
-- everything if the caller is a super admin. The bypass is deliberate and it
-- is the whole reason Korperation can support a client at all -- but it means
-- three accounts can read every customer's data, which is a fact about the
-- product and not an implementation detail.
--
-- PERSONAL_EVENT IS INCLUDED IN THAT BYPASS, which reverses what docs/spec.md
-- said: "An admin who did not write it does not see it... is_admin() is
-- deliberately absent from the read policy". The spec is updated in this same
-- commit rather than left to contradict the schema. It was an explicit
-- decision, not an oversight, and the tenant-switcher screen is what makes it
-- answerable -- a super admin enters a tenancy on purpose rather than seeing
-- every tenancy at once.
--
-- WHAT THIS DOES NOT COVER: the 25 SECURITY DEFINER functions. RLS does not
-- apply inside them, so passing another tenant's uuid to delete_pass or
-- clock_in still works after this migration. That is M2b, and until it lands
-- isolation is real for reads and porous for those writes.
--
-- Four confirmation RPCs people might expect in M2b are covered HERE instead:
-- approve_day, reject_day, confirm_flagged_day and complete_bristsurvey are
-- SECURITY INVOKER, so the project_day and day_review policies below scope
-- them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The predicate every policy below is wrapped in.
--
-- COALESCED, because a null must be a denial (CLAUDE.md, gotcha 3):
-- current_tenant_id() is NULL for a missing or paused account, `p_tenant =
-- NULL` is NULL, and `false or NULL` is NULL -- which a policy would treat as
-- "no" for a read and as a refusal for a write, but only by accident. This
-- says so on purpose.
--
-- SECURITY DEFINER to match app.is_admin() and the rest of the family. It
-- reads no table itself; both of its callees do, and both are definers for the
-- recursion reason M1c documents.
-- ---------------------------------------------------------------------------

create or replace function app.in_tenant(p_tenant uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(app.is_super_admin() or p_tenant = app.current_tenant_id(), false)
$$;

-- ---------------------------------------------------------------------------
-- public.tenant gets its first policy.
--
-- It has had RLS enabled and no policy since M1, which denied everyone --
-- correct while nothing read it. The app now needs to name the tenancy it is
-- in, and a super admin needs the list to choose from.
-- ---------------------------------------------------------------------------

create policy tenant_member_select on public.tenant
  for select to authenticated
  using (app.is_super_admin() or id = app.current_tenant_id());

drop policy account_admin_write on public.account;
create policy account_admin_write on public.account
  for all to authenticated
  using (app.in_tenant(tenant_id) and (app.is_admin()))
  with check (app.in_tenant(tenant_id) and (app.is_admin()));

drop policy account_self_or_admin_select on public.account;
create policy account_self_or_admin_select on public.account
  for select to authenticated
  using (app.in_tenant(tenant_id) and (((id = ( SELECT auth.uid() AS uid)) OR app.is_admin())));

drop policy arbetsdagbok_admin on public.arbetsdagbok;
create policy arbetsdagbok_admin on public.arbetsdagbok
  for all to authenticated
  using (app.in_tenant(tenant_id) and (app.is_admin()))
  with check (app.in_tenant(tenant_id) and (app.is_admin()));

drop policy clock_edit_leader_select on public.clock_edit;
create policy clock_edit_leader_select on public.clock_edit
  for select to authenticated
  using (app.in_tenant(tenant_id) and ((EXISTS ( SELECT 1
        FROM (tilldelning t
          JOIN pass p ON ((p.id = t.pass_id)))
       WHERE ((t.id = clock_edit.tilldelning_id) AND app.leads_project(p.project_id))))));

drop policy day_review_staff_select on public.day_review;
create policy day_review_staff_select on public.day_review
  for select to authenticated
  using (app.in_tenant(tenant_id) and (app.leads_project(project_id)));

drop policy forval_own_write on public.forval;
create policy forval_own_write on public.forval
  for all to authenticated
  using (app.in_tenant(tenant_id) and ((worker_id = app.current_worker_id())))
  with check (app.in_tenant(tenant_id) and ((worker_id = app.current_worker_id())));

drop policy forval_select on public.forval;
create policy forval_select on public.forval
  for select to authenticated
  using (app.in_tenant(tenant_id) and ((app.is_staff() OR (worker_id = app.current_worker_id()))));

drop policy notification_own_select on public.notification;
create policy notification_own_select on public.notification
  for select to authenticated
  using (app.in_tenant(tenant_id) and ((account_id = ( SELECT auth.uid() AS uid))));

drop policy notification_own_update on public.notification;
create policy notification_own_update on public.notification
  for update to authenticated
  using (app.in_tenant(tenant_id) and ((account_id = ( SELECT auth.uid() AS uid))))
  with check (app.in_tenant(tenant_id) and ((account_id = ( SELECT auth.uid() AS uid))));

drop policy pass_leader_insert on public.pass;
create policy pass_leader_insert on public.pass
  for insert to authenticated
  with check (app.in_tenant(tenant_id) and (app.leads_project(project_id)));

drop policy pass_leader_select on public.pass;
create policy pass_leader_select on public.pass
  for select
  using (app.in_tenant(tenant_id) and (((deleted_at IS NULL) AND (app.leads_project(project_id) OR app.holds_the_day(project_id, work_date)))));

drop policy pass_leader_update on public.pass;
create policy pass_leader_update on public.pass
  for update to authenticated
  using (app.in_tenant(tenant_id) and (app.leads_project(project_id)))
  with check (app.in_tenant(tenant_id) and (app.leads_project(project_id)));

drop policy pass_batch_leader on public.pass_batch;
create policy pass_batch_leader on public.pass_batch
  for all to authenticated
  using (app.in_tenant(tenant_id) and (app.leads_project(project_id)))
  with check (app.in_tenant(tenant_id) and (app.leads_project(project_id)));

drop policy handpick_leader on public.pass_batch_handpick;
create policy handpick_leader on public.pass_batch_handpick
  for all to authenticated
  using (app.in_tenant(tenant_id) and ((EXISTS ( SELECT 1
        FROM pass_batch b
       WHERE ((b.id = pass_batch_handpick.batch_id) AND app.leads_project(b.project_id))))))
  with check (app.in_tenant(tenant_id) and ((EXISTS ( SELECT 1
        FROM pass_batch b
       WHERE ((b.id = pass_batch_handpick.batch_id) AND app.leads_project(b.project_id))))));

drop policy pass_block_staff_select on public.pass_block;
create policy pass_block_staff_select on public.pass_block
  for select to authenticated
  using (app.in_tenant(tenant_id) and (app.is_staff()));

drop policy pass_offer_leader_write on public.pass_offer;
create policy pass_offer_leader_write on public.pass_offer
  for all to authenticated
  using (app.in_tenant(tenant_id) and ((EXISTS ( SELECT 1
        FROM pass p
       WHERE ((p.id = pass_offer.pass_id) AND app.leads_project(p.project_id))))))
  with check (app.in_tenant(tenant_id) and ((EXISTS ( SELECT 1
        FROM pass p
       WHERE ((p.id = pass_offer.pass_id) AND app.leads_project(p.project_id))))));

drop policy pass_offer_select on public.pass_offer;
create policy pass_offer_select on public.pass_offer
  for select to authenticated
  using (app.in_tenant(tenant_id) and ((app.is_staff() OR (worker_id = app.current_worker_id()))));

drop policy personal_event_select on public.personal_event;
create policy personal_event_select on public.personal_event
  for select
  using (app.in_tenant(tenant_id) and (((owner_id = ( SELECT auth.uid() AS uid)) OR app.sees_personal_event(id))));

drop policy personal_event_write on public.personal_event;
create policy personal_event_write on public.personal_event
  for all
  using (app.in_tenant(tenant_id) and ((owner_id = ( SELECT auth.uid() AS uid))))
  with check (app.in_tenant(tenant_id) and ((owner_id = ( SELECT auth.uid() AS uid))));

drop policy personal_event_viewer_select on public.personal_event_viewer;
create policy personal_event_viewer_select on public.personal_event_viewer
  for select
  using (app.in_tenant(tenant_id) and (((account_id = ( SELECT auth.uid() AS uid)) OR app.owns_personal_event(event_id))));

drop policy personal_event_viewer_write on public.personal_event_viewer;
create policy personal_event_viewer_write on public.personal_event_viewer
  for all
  using (app.in_tenant(tenant_id) and (app.owns_personal_event(event_id)))
  with check (app.in_tenant(tenant_id) and (app.owns_personal_event(event_id)));

drop policy profile_self_or_admin on public.profile;
create policy profile_self_or_admin on public.profile
  for all
  using (app.in_tenant(tenant_id) and (((account_id = ( SELECT auth.uid() AS uid)) OR app.is_admin())))
  with check (app.in_tenant(tenant_id) and (((account_id = ( SELECT auth.uid() AS uid)) OR app.is_admin())));

drop policy project_admin_write on public.project;
create policy project_admin_write on public.project
  for all to authenticated
  using (app.in_tenant(tenant_id) and ((app.is_admin() AND (deleted_at IS NULL))))
  with check (app.in_tenant(tenant_id) and ((app.is_admin() AND (deleted_at IS NULL))));

drop policy project_staff_insert on public.project;
create policy project_staff_insert on public.project
  for insert to authenticated
  with check (app.in_tenant(tenant_id) and ((app.is_staff() AND (deleted_at IS NULL))));

drop policy project_staff_select on public.project;
create policy project_staff_select on public.project
  for select
  using (app.in_tenant(tenant_id) and (((deleted_at IS NULL) AND (app.leads_project(id) OR app.holds_a_day(id) OR (created_by = ( SELECT auth.uid() AS uid))))));

drop policy project_day_leader on public.project_day;
create policy project_day_leader on public.project_day
  for all
  using (app.in_tenant(tenant_id) and ((app.leads_project(project_id) OR app.holds_the_day(project_id, work_date))))
  with check (app.in_tenant(tenant_id) and ((app.leads_project(project_id) OR app.holds_the_day(project_id, work_date))));

drop policy project_leader_admin_write on public.project_leader;
create policy project_leader_admin_write on public.project_leader
  for all to authenticated
  using (app.in_tenant(tenant_id) and (app.is_admin()))
  with check (app.in_tenant(tenant_id) and (app.is_admin()));

drop policy project_leader_creator_insert on public.project_leader;
create policy project_leader_creator_insert on public.project_leader
  for insert to authenticated
  with check (app.in_tenant(tenant_id) and ((app.is_staff() AND app.created_project(project_id))));

drop policy project_leader_staff_select on public.project_leader;
create policy project_leader_staff_select on public.project_leader
  for select to authenticated
  using (app.in_tenant(tenant_id) and (app.is_staff()));

drop policy tilldelning_leader_select on public.tilldelning;
create policy tilldelning_leader_select on public.tilldelning
  for select
  using (app.in_tenant(tenant_id) and ((EXISTS ( SELECT 1
        FROM pass p
       WHERE ((p.id = tilldelning.pass_id) AND (app.leads_project(p.project_id) OR app.holds_the_day(p.project_id, tilldelning.work_date)))))));

drop policy tilldelning_leader_write on public.tilldelning;
create policy tilldelning_leader_write on public.tilldelning
  for all
  using (app.in_tenant(tenant_id) and ((EXISTS ( SELECT 1
        FROM pass p
       WHERE ((p.id = tilldelning.pass_id) AND (app.leads_project(p.project_id) OR app.holds_the_day(p.project_id, tilldelning.work_date)))))))
  with check (app.in_tenant(tenant_id) and ((EXISTS ( SELECT 1
        FROM pass p
       WHERE ((p.id = tilldelning.pass_id) AND (app.leads_project(p.project_id) OR app.holds_the_day(p.project_id, tilldelning.work_date)))))));

drop policy worker_admin_insert on public.worker;
create policy worker_admin_insert on public.worker
  for insert to authenticated
  with check (app.in_tenant(tenant_id) and (app.is_admin()));

drop policy worker_self_or_admin_select on public.worker;
create policy worker_self_or_admin_select on public.worker
  for select to authenticated
  using (app.in_tenant(tenant_id) and (((account_id = ( SELECT auth.uid() AS uid)) OR app.is_admin())));

drop policy worker_self_profile_update on public.worker;
create policy worker_self_profile_update on public.worker
  for update to authenticated
  using (app.in_tenant(tenant_id) and (((account_id = ( SELECT auth.uid() AS uid)) OR app.is_admin())))
  with check (app.in_tenant(tenant_id) and (((account_id = ( SELECT auth.uid() AS uid)) OR app.is_admin())));

