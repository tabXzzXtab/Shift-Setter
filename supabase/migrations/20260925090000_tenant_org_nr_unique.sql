-- ============================================================================
-- ONE COMPANY, ONE TENANCY.
--
-- create-tenant asks whether a company is already here before it makes one:
-- it selects on org_nr and refuses with "X finns redan med det
-- organisationsnumret." That check is worth having -- it turns the ordinary
-- mistake, onboarding a customer somebody already onboarded, into a sentence
-- rather than a second company -- but it is a check in application code, and
-- it RACES. Two requests in the same second both see nothing and both insert.
--
-- The thing that cannot race is here. A second row with the same org_nr is now
-- refused by the database, so the function's check is what produces a readable
-- Swedish answer in the ordinary case and this is what makes the answer true.
--
-- WHY A DUPLICATE TENANCY IS WORSE THAN A DUPLICATE ROW. Every table in the
-- app carries tenant_id, and a child derives it from its parent. Two tenancies
-- for one company would therefore be two disjoint worlds wearing the same
-- name: projects in one invisible from the other, staff who cannot see their
-- colleagues' shifts, and an Arbetsdagbok that is complete and wrong because
-- the days it is missing are in the other tenancy. Nothing in the app would
-- report a problem -- both halves would look healthy -- and merging them
-- afterwards means re-parenting every row beneath both.
--
-- NORMALISATION IS NOT ATTEMPTED, deliberately. create-tenant enforces the
-- shape 556677-8899 before it writes, so every value that reaches this column
-- already has one form. A functional index that stripped the hyphen would
-- claim to guard values this column cannot hold, and would hide from the next
-- reader that the format rule lives in the function.
--
-- No soft delete on public.tenant, so there is no deleted_at to exclude and no
-- partial index: a tenancy that exists occupies its org_nr, and there is no
-- state in which one does not.
--
-- Safe to apply as it stands: both existing tenancies have distinct
-- organisation numbers (2 rows, 2 distinct org_nr, checked against the live
-- database before writing this).
-- ============================================================================

alter table public.tenant
  add constraint tenant_org_nr_key unique (org_nr);

comment on constraint tenant_org_nr_key on public.tenant is
  'One tenancy per company. create-tenant checks first for a readable answer; '
  'this is what makes the check true under concurrency.';
