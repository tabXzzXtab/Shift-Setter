-- ============================================================================
-- tenant_id defaults to THE CALLER'S TENANT.
--
-- FIXING A REGRESSION M1 SHIPPED. M1 gave all 19 tables a NOT NULL tenant_id,
-- used a literal default to fill the existing rows without firing any trigger,
-- and then dropped that default -- the reasoning being that an INSERT which
-- forgets tenant_id should fail loudly rather than quietly join a tenant.
--
-- It does fail loudly. It fails for every write the application makes:
--
--   project, project_leader        Nytt Projekt
--   pass, pass_batch, handpick     Skapa Pass
--   project_day                    Bekrafta Pass -- the stage 1 confirmation
--   arbetsdagbok                   generating the document itself
--   personal_event + viewer        Tilldela Arende
--   profile                        Profil, and every avatar
--   forval                         Min kalender
--   account, worker                the create-account Edge Function
--
-- none of which had ever heard of tenants. The suite did not catch it because
-- the suite restores defaults inside its own transaction to make 147 fixture
-- inserts work -- scaffolding that turned out to mask the live breakage as
-- well as the isolation it was known to mask.
--
-- THE DEFAULT IS A FUNCTION, NOT A LITERAL, and the difference is the whole
-- point. M1's literal was correct for one statement -- every row that existed
-- then belonged to one tenant -- and would be a cross-tenant bug as a standing
-- default, stamping a second client's projects with the first client's tenant.
-- app.current_tenant_id() reads the caller's own account row, so a row lands
-- in the tenant of whoever wrote it. That is also exactly what M2's WITH CHECK
-- will require, so this is not a stopgap that has to be undone later.
--
-- ALTER COLUMN SET DEFAULT is catalogue-only: no rewrite, no lock beyond the
-- statement, no trigger, nothing touched in any row.
--
-- IT DOES NOT COVER A SERVICE-ROLE CALLER, and must not. An Edge Function
-- holds the service-role key and has no auth.uid(), so current_tenant_id()
-- returns NULL there and the insert still fails. That is correct: nothing
-- about a service-role connection says which tenant it is acting for, and
-- guessing would be how one customer's worker ends up in another's company.
-- create-account reads the calling ADMIN's tenant and sends it explicitly; so
-- will create-tenant, which is the one caller that legitimately writes into a
-- tenant that is not its own.
-- ============================================================================

alter table public.account               alter column tenant_id set default app.current_tenant_id();
alter table public.worker                alter column tenant_id set default app.current_tenant_id();
alter table public.profile               alter column tenant_id set default app.current_tenant_id();
alter table public.project               alter column tenant_id set default app.current_tenant_id();
alter table public.project_leader        alter column tenant_id set default app.current_tenant_id();
alter table public.project_day           alter column tenant_id set default app.current_tenant_id();
alter table public.pass                  alter column tenant_id set default app.current_tenant_id();
alter table public.pass_batch            alter column tenant_id set default app.current_tenant_id();
alter table public.pass_batch_handpick   alter column tenant_id set default app.current_tenant_id();
alter table public.pass_block            alter column tenant_id set default app.current_tenant_id();
alter table public.pass_offer            alter column tenant_id set default app.current_tenant_id();
alter table public.tilldelning           alter column tenant_id set default app.current_tenant_id();
alter table public.forval                alter column tenant_id set default app.current_tenant_id();
alter table public.clock_edit            alter column tenant_id set default app.current_tenant_id();
alter table public.day_review            alter column tenant_id set default app.current_tenant_id();
alter table public.arbetsdagbok          alter column tenant_id set default app.current_tenant_id();
alter table public.notification          alter column tenant_id set default app.current_tenant_id();
alter table public.personal_event        alter column tenant_id set default app.current_tenant_id();
alter table public.personal_event_viewer alter column tenant_id set default app.current_tenant_id();
