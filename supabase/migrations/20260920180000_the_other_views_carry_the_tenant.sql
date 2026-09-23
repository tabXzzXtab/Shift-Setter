-- ============================================================================
-- THE VIEWS CARRY THE TENANT TOO -- the other six.
--
-- A view with security_invoker = false runs as its OWNER, so RLS on the tables
-- underneath does not apply to it. M2a scoped 35 policies and M2b scoped 21
-- functions; these six read straight past both.
--
-- 19addef did my_offer, my_shift and open_pass. These are the rest. They were
-- reported as two -- account_directory and worker_roster -- and the other four
-- have the same defect for the same reason, so fixing two would have left the
-- hole open in four places while looking closed.
--
-- WHAT THEY WERE GUARDED BY, AND WHY THAT WAS NOT ENOUGH. Each one already
-- tests app.is_admin(), app.is_staff() or app.leads_project(). All three are
-- tenant-blind: is_admin() is true for an admin of ANY company, and
-- leads_project() falls back to is_admin() on purpose. So the guard that was
-- there answered "is this person staff?" when the question is "is this row
-- theirs?".
--
-- SECURITY_INVOKER IS NOT THE FIX, and not only because it is a bigger change.
-- account_directory and arbetsledare_roster join auth.users, which the
-- authenticated role cannot select from at all -- flipping them would replace
-- a leak with an empty screen on every page load.
--
-- Written as CREATE OR REPLACE from the live definition with one predicate
-- added, and with security_invoker = false restated so a replace cannot drop
-- it silently. Column names and order are unchanged, which CREATE OR REPLACE
-- requires anyway.
-- ============================================================================

-- account_directory: Reads auth.users, which `authenticated` cannot select from -- so this one
-- cannot become security_invoker without breaking the join, and the
-- predicate is the only route. It is also what useAccount() reads on every
-- page load, so a leak here is every screen at once.
create or replace view public.account_directory with (security_invoker = false) as
 SELECT a.id,
    a.role,
    a.active,
    w.id AS worker_id,
    COALESCE(w.name, u.raw_user_meta_data ->> 'name'::text) AS name,
    COALESCE(w.email, u.email::text) AS email,
    p.avatar_path
   FROM account a
     LEFT JOIN worker w ON w.account_id = a.id AND w.deleted_at IS NULL
     LEFT JOIN auth.users u ON u.id = a.id
     LEFT JOIN profile p ON p.account_id = a.id
  WHERE a.deleted_at IS NULL AND app.in_tenant(a.tenant_id)
    AND (app.is_admin() OR a.id = (( SELECT auth.uid() AS uid)));

-- worker_roster: app.is_staff() with no object: true for any leader of any company.
create or replace view public.worker_roster with (security_invoker = false) as
 SELECT w.id,
    w.name,
    w.late_marks,
    a.role
   FROM worker w
     JOIN account a ON a.id = w.account_id
  WHERE w.deleted_at IS NULL AND app.in_tenant(w.tenant_id) AND app.is_staff();

-- arbetsledare_roster: The picker for 'who is responsible'. Also joins auth.users. Without this a
-- client's admin could name another company's arbetsledare on their own
-- project -- and the composite keys would then refuse the write, so the
-- symptom was a failure with no explanation rather than a visible leak.
create or replace view public.arbetsledare_roster with (security_invoker = false) as
 SELECT a.id,
    COALESCE(w.name, u.raw_user_meta_data ->> 'name'::text) AS name
   FROM account a
     LEFT JOIN worker w ON w.account_id = a.id AND w.deleted_at IS NULL
     LEFT JOIN auth.users u ON u.id = a.id
  WHERE a.role = 'arbetsledare'::app_role AND a.active
    AND app.in_tenant(a.tenant_id) AND app.is_staff();

-- cancelled_day: app.leads_project() falls back to app.is_admin() (CLAUDE.md says so
-- deliberately), so an admin passes it for EVERY project, not only their
-- own company's. That fallback is what makes these last three leak.
create or replace view public.cancelled_day with (security_invoker = false) as
 SELECT p.project_id,
    p.work_date,
    pr.name AS project_name,
    count(*)::integer AS cancelled_passes,
    max(p.deleted_at) AS cancelled_at
   FROM pass p
     JOIN project pr ON pr.id = p.project_id AND pr.deleted_at IS NULL
  WHERE p.deleted_at IS NOT NULL AND app.leads_project(p.project_id) AND NOT (EXISTS ( SELECT 1
           FROM pass q
          WHERE q.project_id = p.project_id AND q.work_date = p.work_date AND q.deleted_at IS NULL))
    AND app.in_tenant(pr.tenant_id)
  GROUP BY p.project_id, p.work_date, pr.name;

-- day_history: Confirmation history: who confirmed what, when, and the rejection notes.
-- Same is_admin() fallback through leads_project().
create or replace view public.day_history with (security_invoker = false) as
 SELECT pd.project_id,
    pr.name AS project_name,
    pd.work_date,
    pd.vad_vi_gjorde,
    pd.stage,
    pd.confirmed_via,
    pd.confirmed_at,
    COALESCE(cw.name, ca.role::text) AS confirmed_by_name,
    pd.reviewed_at,
    COALESCE(rw.name, ra.role::text) AS reviewed_by_name,
    pd.rejected_at,
    pd.rejection_note,
    (EXISTS ( SELECT 1
           FROM arbetsdagbok a
          WHERE a.project_id = pd.project_id AND pd.work_date <@ a.covered)) AS filed
   FROM project_day pd
     JOIN project pr ON pr.id = pd.project_id AND pr.deleted_at IS NULL
     LEFT JOIN account ca ON ca.id = pd.confirmed_by
     LEFT JOIN worker cw ON cw.account_id = pd.confirmed_by AND cw.deleted_at IS NULL
     LEFT JOIN account ra ON ra.id = pd.reviewed_by
     LEFT JOIN worker rw ON rw.account_id = pd.reviewed_by AND rw.deleted_at IS NULL
  WHERE pd.confirmed_at IS NOT NULL AND app.leads_project(pd.project_id) AND (pd.stage = 'admin_confirmed'::day_stage OR (EXISTS ( SELECT 1
           FROM arbetsdagbok a
          WHERE a.project_id = pd.project_id AND pd.work_date <@ a.covered)))
    AND app.in_tenant(pd.tenant_id);

-- project_hours: Hours per project. Same fallback again -- and hours are the one number
-- this whole product exists to get right.
create or replace view public.project_hours with (security_invoker = false) as
 SELECT pr.id AS project_id,
    pr.name,
    pr.site_address,
    pr.start_date,
    COALESCE(sum(t.confirmed_hours) FILTER (WHERE w.id IS NOT NULL), 0::numeric) AS hours
   FROM project pr
     LEFT JOIN pass p ON p.project_id = pr.id AND p.deleted_at IS NULL
     LEFT JOIN tilldelning t ON t.pass_id = p.id AND t.released_at IS NULL
     LEFT JOIN worker w ON w.id = t.worker_id AND w.deleted_at IS NULL
  WHERE pr.deleted_at IS NULL AND app.leads_project(pr.id)
    AND app.in_tenant(pr.tenant_id)
  GROUP BY pr.id, pr.name, pr.site_address, pr.start_date;

