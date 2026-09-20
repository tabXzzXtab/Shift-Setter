-- ============================================================================
-- THE VIEWS CARRY THE TENANT TOO.
--
-- M2a put `app.in_tenant(tenant_id) and (<what was there>)` on all 34
-- policies. It could not reach these three, because they are not policies:
-- open_pass, my_offer and my_shift are all `security_invoker = false`, which
-- is deliberate and still right -- an arbetare cannot read public.pass at all,
-- the policy being scoped to app.leads_project, so these reach a worker
-- through a view running as its owner or not at all.
--
-- A VIEW RUNNING AS ITS OWNER NEVER MEETS A POLICY. That is the whole point of
-- the setting and it is also the hole: M2a's clause is attached to the policy,
-- the policy is skipped, and nothing else in the view body mentioned tenancy.
--
-- MEASURED, NOT REASONED. A project and an open pass were planted in the
-- operator tenant and read back as a Bella Service arbetare:
--
--   public.open_pass   ->  1 row: 'LEAK PROBE operator site',
--                          'Operatorgatan 1, 111 11 Stockholm', 3 platser kvar
--   public.pass        ->  0 rows, the same row, denied by M2a's policy
--
-- The screen draws project_name, site_address and the slot count, so every
-- field of that row was a field Oppna Pass would have rendered to a worker at
-- another company.
--
-- WHY open_pass AND NOT ONLY open_pass. Only open_pass actually leaked, and
-- the reason the other two did not is worth stating because it is the same
-- reason that failed here: they are scoped to app.current_worker_id(), so they
-- were safe BY CONSTRUCTION rather than by enforcement. A worker's own offers
-- and own assignments can only be for passes the tenant-filtered fill_pass put
-- them on. open_pass is scoped to nobody -- it lists every open future pass in
-- the database and subtracts the days this worker already holds -- so the same
-- construction argument was never available to it, and nobody noticed that the
-- argument was doing load-bearing work in two places and no work in the third.
-- Safe by construction is what this is fixing. All three get the clause.
--
-- ONE PREDICATE PER VIEW, EVERYTHING ELSE VERBATIM, which is how M2a did the
-- policies and for the same reason: a hand-rewritten body can quietly drop a
-- clause somebody added since the file was last read. Each body below is
-- pg_get_viewdef output with one `and app.in_tenant(...)` added.
--
-- THE TENANT IS READ OFF THE PASS, not off the project or the worker. pass
-- derives tenant_id from its project through M1c's aa_tenant_from_parent
-- trigger, so the two cannot disagree -- and the pass is the row the screen is
-- actually offering. app.in_tenant() is STABLE and SECURITY DEFINER and reads
-- the JWT claim and app.acting_tenant, neither of which depends on the calling
-- role, so it behaves identically inside an owner-run view. A super admin
-- keeps the bypass they have everywhere else, and loses it while acting inside
-- a client, exactly as on the 34 policies.
-- ============================================================================

create or replace view public.open_pass with (security_invoker = false) as
select
  p.id            as pass_id,
  p.work_date,
  p.start_time,
  p.end_time,
  p.planned_hours,
  p.headcount,
  pr.name         as project_name,
  pr.site_address,
  p.headcount - count(t.id) as slots_open
from public.pass p
  join public.project pr on pr.id = p.project_id and pr.deleted_at is null
  left join public.tilldelning t on t.pass_id = p.id and t.released_at is null
where app.in_tenant(p.tenant_id)          -- M2a's clause, reaching a view
  and p.deleted_at is null
  and app.pass_start_at(p.work_date, p.start_time) > now()
  and not exists (
    select 1 from public.tilldelning mine
    where mine.worker_id = app.current_worker_id()
      and mine.work_date = p.work_date
      and mine.released_at is null
  )
group by p.id, p.work_date, p.start_time, p.end_time,
         p.planned_hours, p.headcount, pr.name, pr.site_address
having p.headcount - count(t.id) > 0;

create or replace view public.my_offer with (security_invoker = false) as
select
  o.pass_id,
  p.work_date,
  p.start_time,
  p.end_time,
  p.planned_hours,
  pr.name as project_name,
  pr.site_address
from public.pass_offer o
  join public.pass p on p.id = o.pass_id and p.deleted_at is null
  join public.project pr on pr.id = p.project_id and pr.deleted_at is null
where app.in_tenant(p.tenant_id)
  and o.state = 'offered'::public.offer_state
  and o.worker_id = app.current_worker_id()
  and not exists (
    select 1 from public.tilldelning t
    where t.worker_id = o.worker_id
      and t.work_date = p.work_date
      and t.released_at is null
  );

create or replace view public.my_shift with (security_invoker = false) as
select
  t.id,
  t.pass_id,
  p.project_id,
  pr.name as project_name,
  pr.site_address,
  p.work_date,
  coalesce(t.own_start, p.start_time) as start_time,
  coalesce(t.own_end, p.end_time) as end_time,
  p.planned_hours,
  t.clock_in,
  t.clock_out,
  -- INVARIANT 10 is untouched: the figure still appears only once an
  -- Arbetsdagbok covers the date.
  case when exists (
         select 1 from public.arbetsdagbok a
         where a.project_id = p.project_id and p.work_date <@ a.covered)
       then t.confirmed_hours else null::numeric end as confirmed_hours,
  pd.confirmed_at is not null as day_confirmed,
  exists (
    select 1 from public.arbetsdagbok a
    where a.project_id = p.project_id and p.work_date <@ a.covered) as filed
from public.tilldelning t
  join public.pass p on p.id = t.pass_id and p.deleted_at is null
  join public.project pr on pr.id = p.project_id and pr.deleted_at is null
  left join public.project_day pd
    on pd.project_id = p.project_id and pd.work_date = p.work_date
where app.in_tenant(p.tenant_id)
  and t.released_at is null
  and t.worker_id = app.current_worker_id();

-- create or replace view keeps existing grants, but they are restated so this
-- file is readable on its own and so a future DROP/CREATE cannot silently
-- leave a view ungranted.
grant select on public.open_pass to authenticated;
grant select on public.my_offer  to authenticated;
grant select on public.my_shift  to authenticated;
revoke all on public.open_pass from anon;
revoke all on public.my_offer  from anon;
revoke all on public.my_shift  from anon;
