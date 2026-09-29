-- ============================================================================
-- Analytics: time on screen and taps, per screen and role. For the operator.
--
-- WHAT IS RECORDED, AND WHAT IS NOT. A row says a screen was entered or left,
-- or tapped, by SOMEBODY IN A ROLE IN A COMPANY. There is no account id: the
-- question is how long a screen takes an arbetare, not how long Ada took, and
-- a column that could answer the second question would be personal data kept
-- for no purpose. Screens are paths only -- a query string is where this app
-- carries ids -- and a tap names the kind of element and, where the screen
-- gives it one, a data-analytics key. Never the element's text: button labels
-- here carry workers' and projects' names. The CHECKs below hold that line
-- whatever a client sends.
--
-- WRITE-ONLY FROM THE APP. One INSERT policy and no other. Nobody reads the
-- raw rows through PostgREST, the company's own admin included, and nobody
-- edits or deletes one: the privileges are not granted, and there is no
-- policy that would let them through if they were.
--
-- The insert policy is the boundary, not the client:
--   - into your own tenancy (invariant 12; the row has no parent, so the
--     tenancy is the caller's own -- by default, and checked);
--   - as the role you actually hold, so a worker cannot file an admin's time;
--   - never by the operator, acting or not. The operator is not a user of the
--     product, and time spent inside a client's tenancy would be counted as
--     that client's. (Automated browsers are excluded by the client; the
--     database cannot tell a walkthrough from a person.)
--
-- READ ONLY BY THE OPERATOR, through two SECURITY DEFINER functions that
-- return aggregates. They cross tenancies deliberately -- the operator's
-- crossing is CLAUDE.md's one sanctioned exception, and exactly what
-- app.guard_tenant() would otherwise refuse, which is why they do not call it.
-- p_tenant narrows to one company.
--
-- No retention. Rows are kept until someone decides otherwise; there is no
-- cron to prune them (see "no scheduled jobs" in CLAUDE.md).
-- ============================================================================

create table public.analytics_event (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null default app.current_tenant_id() references public.tenant(id),
  role        public.app_role not null,
  kind        text not null check (kind in ('screen_enter', 'screen_exit', 'tap')),
  screen      text not null check (screen ~ '^/[a-z0-9/-]*$' and length(screen) <= 80),
  visit_id    uuid not null,
  client_at   timestamptz not null,
  received_at timestamptz not null default now(),
  duration_ms integer check (duration_ms between 0 and 86400000),
  -- An identifier, never prose: lower-case letters, digits and . : _ - only.
  -- "Bo T123" cannot be stored, which is the point.
  element     text check (element ~ '^[a-z0-9:._-]{1,80}$'),
  x           smallint check (x >= 0),
  y           smallint check (y >= 0),
  vw          smallint check (vw > 0),
  vh          smallint check (vh > 0),
  scroll_y    integer check (scroll_y >= 0),

  constraint analytics_duration_only_on_exit
    check (kind = 'screen_exit' or duration_ms is null),
  constraint analytics_tap_is_complete
    check ((kind = 'tap') = (element is not null and x is not null and y is not null
                             and vw is not null and vh is not null and scroll_y is not null))
);

create index analytics_event_window on public.analytics_event (kind, received_at);
create index analytics_event_screen on public.analytics_event (screen, role, kind);

alter table public.analytics_event enable row level security;

revoke all on public.analytics_event from anon, authenticated;
grant insert on public.analytics_event to authenticated;

create policy analytics_event_insert on public.analytics_event
  for insert to authenticated
  with check (
    app.in_tenant(tenant_id)
    and coalesce(role = app.current_role(), false)
    and not app.is_super_admin()
  );

-- ---------------------------------------------------------------------------
-- The operator's reads.
-- ---------------------------------------------------------------------------

-- One guard for both, so they cannot drift apart. is_super_admin() coalesces
-- a missing or paused account to false, so a null can never let this through.
create or replace function app.require_super_admin() returns void
  language plpgsql stable security definer
  set search_path = ''
as $fn$
begin
  if not app.is_super_admin() then
    raise exception 'only the operator reads analytics'
      using errcode = 'insufficient_privilege';
  end if;
end $fn$;

-- Time on screen per screen and role, from the exits: the phone measures the
-- visit and sends it with the exit, so a visit whose exit never arrived is not
-- counted rather than counted as endless. Half-open window on received_at --
-- a phone's own clock is not something to filter by.
create or replace function public.analytics_screen_times(
  p_from timestamptz, p_to timestamptz, p_tenant uuid default null)
returns table (screen text, role public.app_role, visits bigint,
               avg_ms integer, median_ms integer, p90_ms integer, taps bigint)
  language plpgsql stable security definer
  set search_path = ''
as $fn$
begin
  perform app.require_super_admin();
  return query
    with ev as (
      select e.screen, e.role, e.kind, e.duration_ms
        from public.analytics_event e
       where e.received_at >= p_from and e.received_at < p_to
         and (p_tenant is null or e.tenant_id = p_tenant)
         and e.kind in ('screen_exit', 'tap')
    )
    select ev.screen, ev.role,
           count(*) filter (where ev.kind = 'screen_exit'),
           round(avg(ev.duration_ms) filter (where ev.kind = 'screen_exit'))::integer,
           round(percentile_cont(0.5) within group (order by ev.duration_ms)
                 filter (where ev.kind = 'screen_exit'))::integer,
           round(percentile_cont(0.9) within group (order by ev.duration_ms)
                 filter (where ev.kind = 'screen_exit'))::integer,
           count(*) filter (where ev.kind = 'tap')
      from ev
     group by ev.screen, ev.role
     order by ev.screen, ev.role;
end $fn$;

-- Taps on one screen for one role, binned on a grid 20 wide. The column is the
-- share of the viewport's width; the row is the tap's position on the PAGE in
-- twentieths of a viewport height, so a screen that scrolls keeps going down
-- rather than piling its lower half onto its first screenful.
create or replace function public.analytics_taps(
  p_screen text, p_role public.app_role,
  p_from timestamptz, p_to timestamptz, p_tenant uuid default null)
returns table (x_bin integer, y_bin integer, taps bigint)
  language plpgsql stable security definer
  set search_path = ''
as $fn$
begin
  perform app.require_super_admin();
  return query
    select least(19, greatest(0, floor(e.x::numeric / e.vw * 20)))::integer,
           least(399, greatest(0, floor((e.y + e.scroll_y)::numeric / e.vh * 20)))::integer,
           count(*)
      from public.analytics_event e
     where e.kind = 'tap'
       and e.screen = p_screen and e.role = p_role
       and e.received_at >= p_from and e.received_at < p_to
       and (p_tenant is null or e.tenant_id = p_tenant)
     group by 1, 2
     order by 1, 2;
end $fn$;

revoke all on function app.require_super_admin() from public;
revoke all on function public.analytics_screen_times(timestamptz, timestamptz, uuid) from public;
revoke all on function public.analytics_taps(text, public.app_role, timestamptz, timestamptz, uuid) from public;
grant execute on function app.require_super_admin() to authenticated;
grant execute on function public.analytics_screen_times(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.analytics_taps(text, public.app_role, timestamptz, timestamptz, uuid) to authenticated;

-- Recorded in the CLI's ledger, like the migration before it, so `supabase db
-- push` stays the no-op that 20260928100000 made it.
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260929100000', 'analytics', null)
on conflict (version) do nothing;
