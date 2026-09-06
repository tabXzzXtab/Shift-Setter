-- ============================================================================
-- A CANCELLED DAY MUST NOT READ AS AN EMPTY ONE.
--
-- Deleting the last shift on a day already did everything it should: the
-- people on it are released, told, and blocked from being re-offered it. What
-- it could not do was leave a mark. The shift is soft-deleted and
-- pass_leader_select carries `deleted_at is null`, so from the interface the
-- day simply becomes empty -- indistinguishable from a day nobody ever booked.
--
-- Those are different facts. "Nothing was ever planned here" and "what was
-- planned here was called off" lead to different actions, and an admin
-- scrolling the calendar for a gap to fill should not have to remember which
-- days he cancelled.
--
-- WHY A VIEW AND NOT A WIDER POLICY. The obvious fix -- letting staff read
-- deleted passes -- is the wrong one. Invariant 8's rule is that deleted rows
-- count nowhere, and a dozen reads across the app filter on deleted_at
-- themselves; loosening the policy would put cancelled shifts back into the
-- month grid, the confirmation queue and the tier walk, and each of those
-- would have to be found and re-defended. This exposes the FACT of a
-- cancellation and nothing that could be mistaken for a shift: no times, no
-- headcount, no assignments, nothing to count.
--
-- SCOPED THE WAY PASSES ARE. app.leads_project(), so an arbetsledare sees
-- cancellations on their own sites and the admin sees all of them. Not
-- app.is_staff(): who cancelled what on somebody else's project is not
-- everyone's business.
-- ============================================================================

create or replace view public.cancelled_day with (security_invoker = false) as
select p.project_id,
       p.work_date,
       pr.name                as project_name,
       count(*)::integer      as cancelled_passes,
       max(p.deleted_at)      as cancelled_at
from public.pass p
join public.project pr on pr.id = p.project_id and pr.deleted_at is null  -- invariant 8
where p.deleted_at is not null
  and app.leads_project(p.project_id)
  -- ONLY WHEN NOTHING SURVIVES. A day with one shift called off and another
  -- still running is not a cancelled day -- somebody is still working it, and
  -- saying otherwise would be worse than saying nothing.
  and not exists (
    select 1 from public.pass q
    where q.project_id = p.project_id
      and q.work_date  = p.work_date
      and q.deleted_at is null
  )
group by p.project_id, p.work_date, pr.name;

-- Supabase's default privileges on schema public hand a NEW object to anon and
-- authenticated alike, and all of insert/update/delete/truncate with it. Every
-- other view here carries authenticated only, so this one is put back to that
-- rather than left looking different. The view is unwritable and would return
-- nothing to anon anyway -- app.leads_project() is false without an auth.uid()
-- -- but a grant nobody asked for is how a safe-by-accident object stops being
-- safe when the thing it depends on changes.
revoke all on public.cancelled_day from anon, authenticated;
grant select on public.cancelled_day to authenticated;
