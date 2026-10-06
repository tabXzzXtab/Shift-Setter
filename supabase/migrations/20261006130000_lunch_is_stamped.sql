-- ============================================================================
-- LUNCH: Stämpla In -> Lunch Paus -> Fortsätt Passet -> Stämpla Ut
--
-- Every press is a row in public.stamp_event, append-only evidence like the
-- clock stamps it sits beside (invariant 3). Owner decisions, 2026-10-06:
--   - more than one break per shift;
--   - Stämpla Ut during a break ends the break at the same instant -- a
--     worker who leaves from lunch is never stuck;
--   - no geofence on the lunch buttons (that is the browser's, in any case);
--   - the bristsurvey subtracts stamped breaks from the clock span (the
--     invariant 1 exception, updated in CLAUDE.md and spec.md);
--   - no correcting a break's times for launch.
--
-- tilldelning.clock_in / clock_out stay the WORKING values every reader
-- already uses -- Bekräfta, Granska, Stäng pass, the survey, my_shift. The
-- stamp function writes them in the same transaction as the event, so
-- nothing that reads them changes. A break is never hours: it is shown next
-- to the stamps, and the leader still types the figure (invariant 1).
-- ============================================================================

create type public.stamp_kind as enum ('in', 'lunch_start', 'lunch_end', 'out');

create table public.stamp_event (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenant(id),
  tilldelning_id uuid not null references public.tilldelning(id) on delete cascade,
  kind           public.stamp_kind not null,
  at             timestamptz not null default now(),
  stamped_by     uuid references public.account(id),
  constraint stamp_event_tenant_matches_tilldelning
    foreign key (tilldelning_id, tenant_id)
    references public.tilldelning (id, tenant_id) deferrable
);

create index stamp_event_tilldelning on public.stamp_event (tilldelning_id, at, id);

comment on table public.stamp_event is
  'One row per press of Stämpla In / Lunch Paus / Fortsätt Passet / Stämpla Ut. Append-only. Written only by public.stamp().';

-- Invariant 12: a child derives its tenancy from its parent.
create trigger aa_tenant_from_parent
  before insert on public.stamp_event
  for each row execute function app.tg_tenant_from_parent('tilldelning', 'tilldelning_id');

-- Invariant 3: evidence is not edited. A DELETE is allowed only as the
-- cascade of its tilldelning being erased -- an account removed before it
-- ever did anything (delete_account) -- where the RI trigger runs first and
-- this one is nested inside it.
create or replace function app.tg_stamp_event_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'stamps are append-only evidence and cannot be changed'
      using errcode = 'check_violation';
  end if;
  if pg_trigger_depth() <= 1 then
    raise exception 'stamps are append-only evidence and cannot be deleted'
      using errcode = 'check_violation';
  end if;
  return old;
end $$;

create trigger stamp_event_append_only
  before update or delete on public.stamp_event
  for each row execute function app.tg_stamp_event_append_only();

-- Readable by whoever can read the assignment: tilldelning's own policies
-- decide that, as the caller (gotcha 2). A worker reads their own break
-- through my_shift.lunch_since, the way they read their stamps.
alter table public.stamp_event enable row level security;
create policy stamp_event_select on public.stamp_event
  for select to authenticated
  using (app.in_tenant(tenant_id)
         and exists (select 1 from public.tilldelning t where t.id = stamp_event.tilldelning_id));
grant select on public.stamp_event to authenticated;

-- ----------------------------------------------------------------------------
-- Seconds on break, from the events. Each lunch_start runs to the lunch_end
-- after it; one still open runs to p_until (the clock-out). Never negative.
-- ----------------------------------------------------------------------------
create or replace function app.lunch_seconds(p_tilldelning uuid, p_until timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(greatest(0, extract(epoch from (
           coalesce(case when x.next_kind = 'lunch_end' then x.next_at end, p_until, x.at)
           - x.at)))), 0)
  from (
    select e.kind, e.at,
           lead(e.kind) over w as next_kind,
           lead(e.at)   over w as next_at
    from public.stamp_event e
    where e.tilldelning_id = p_tilldelning and e.kind in ('lunch_start', 'lunch_end')
    window w as (order by e.at, e.id)
  ) x
  where x.kind = 'lunch_start'
$$;
grant execute on function app.lunch_seconds(uuid, timestamptz) to authenticated;

-- What existed before this table: a stamp in the columns becomes an event at
-- its ORIGINAL time, attributed to the worker who made it.
insert into public.stamp_event (tilldelning_id, kind, at, stamped_by)
select t.id, 'in', t.clock_in_original, w.account_id
from public.tilldelning t join public.worker w on w.id = t.worker_id
where t.clock_in_original is not null;

insert into public.stamp_event (tilldelning_id, kind, at, stamped_by)
select t.id, 'out', t.clock_out_original, w.account_id
from public.tilldelning t join public.worker w on w.id = t.worker_id
where t.clock_out_original is not null;

-- ----------------------------------------------------------------------------
-- public.stamp -- the only writer. The order is the database's:
--   in           only before anything;
--   lunch_start  only while in and not on a break;
--   lunch_end    only on a break;
--   out          only while in -- and on a break it closes the break first,
--                at the same instant.
-- The state comes from the COLUMNS for in/out (a leader may have corrected
-- them, and rows stamped before this table existed carry them) and from the
-- events for the break.
-- ----------------------------------------------------------------------------
create or replace function public.stamp(p_tilldelning uuid, p_kind public.stamp_kind)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker uuid := app.current_worker_id();
  v_now    timestamptz := now();
  v_row    public.tilldelning;
  v_lunch  boolean;
begin
  perform app.guard_tenant('tilldelning', p_tilldelning);

  select * into v_row from public.tilldelning t
  where t.id = p_tilldelning and t.worker_id = v_worker and t.released_at is null
  for update;
  if not found then
    raise exception 'not your shift, or no longer assigned'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.clock_out is not null then
    raise exception 'already clocked out of this shift'
      using errcode = 'check_violation';
  end if;

  select e.kind = 'lunch_start' into v_lunch
  from public.stamp_event e
  where e.tilldelning_id = p_tilldelning and e.kind in ('lunch_start', 'lunch_end')
  order by e.at desc, e.id desc
  limit 1;
  v_lunch := coalesce(v_lunch, false);

  if p_kind = 'in' then
    if v_row.clock_in is not null then
      raise exception 'already clocked in' using errcode = 'check_violation';
    end if;
    update public.tilldelning t set clock_in = v_now where t.id = p_tilldelning;
  elsif v_row.clock_in is null then
    raise exception 'not clocked in yet' using errcode = 'check_violation';
  elsif p_kind = 'lunch_start' then
    if v_lunch then
      raise exception 'already on a break' using errcode = 'check_violation';
    end if;
  elsif p_kind = 'lunch_end' then
    if not v_lunch then
      raise exception 'not on a break' using errcode = 'check_violation';
    end if;
  elsif p_kind = 'out' then
    if v_lunch then
      insert into public.stamp_event (tilldelning_id, kind, at, stamped_by)
      values (p_tilldelning, 'lunch_end', v_now, (select auth.uid()));
    end if;
    update public.tilldelning t set clock_out = v_now where t.id = p_tilldelning;
  end if;

  insert into public.stamp_event (tilldelning_id, kind, at, stamped_by)
  values (p_tilldelning, p_kind, v_now, (select auth.uid()));
  return v_now;
end $$;

revoke all on function public.stamp(uuid, public.stamp_kind) from public, anon;
grant execute on function public.stamp(uuid, public.stamp_kind) to authenticated;

-- The two old entry points, for a bundle still in somebody's browser: they
-- now go through the same door, so their presses are events too.
create or replace function public.clock_in(p_tilldelning uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $$ select public.stamp(p_tilldelning, 'in') $$;

create or replace function public.clock_out(p_tilldelning uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $$ select public.stamp(p_tilldelning, 'out') $$;

-- ----------------------------------------------------------------------------
-- my_shift.lunch_since: when the open break began, or null. The view runs as
-- its owner and carries its own tenant and worker predicate (invariant 12),
-- so the column is scoped by the rows it sits on.
-- ----------------------------------------------------------------------------
create or replace view public.my_shift with (security_invoker = false) as
 SELECT t.id,
    t.pass_id,
    p.project_id,
    pr.name AS project_name,
    pr.site_address,
    p.work_date,
    COALESCE(t.own_start, p.start_time) AS start_time,
    COALESCE(t.own_end, p.end_time) AS end_time,
    p.planned_hours,
    t.clock_in,
    t.clock_out,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM public.arbetsdagbok a
              WHERE a.project_id = p.project_id AND p.work_date <@ a.covered)) THEN t.confirmed_hours
            ELSE NULL::numeric
        END AS confirmed_hours,
    pd.confirmed_at IS NOT NULL AS day_confirmed,
    (EXISTS ( SELECT 1
           FROM public.arbetsdagbok a
          WHERE a.project_id = p.project_id AND p.work_date <@ a.covered)) AS filed,
    ( SELECT CASE WHEN e.kind = 'lunch_start' THEN e.at END
        FROM public.stamp_event e
       WHERE e.tilldelning_id = t.id AND e.kind IN ('lunch_start', 'lunch_end')
       ORDER BY e.at DESC, e.id DESC
       LIMIT 1) AS lunch_since
   FROM public.tilldelning t
     JOIN public.pass p ON p.id = t.pass_id AND p.deleted_at IS NULL
     JOIN public.project pr ON pr.id = p.project_id AND pr.deleted_at IS NULL
     LEFT JOIN public.project_day pd ON pd.project_id = p.project_id AND pd.work_date = p.work_date
  WHERE app.in_tenant(p.tenant_id) AND t.released_at IS NULL AND t.worker_id = app.current_worker_id();

-- ----------------------------------------------------------------------------
-- The bristsurvey: the clock span LESS stamped breaks (owner, 2026-10-06).
-- Both the figures the survey shows and the ones it files, so the admin books
-- exactly what they were shown.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_bristsurvey(p_project uuid, p_work_date date, p_text text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_over numeric;
  v_who  text;
begin
  if not app.is_admin() then
    raise exception 'only an admin completes a bristsurvey'
      using errcode = 'insufficient_privilege';
  end if;

  if p_text is null or btrim(p_text) = '' then
    raise exception 'the day needs an account of what was done'
      using errcode = 'check_violation';
  end if;

  -- numeric(4,2) tops out at 99.99. A worker who never clocked out turns into
  -- a span of days, and silently storing 24 or clamping would be inventing a
  -- figure -- the one thing this path must not do. Say which day and who.
  select round((extract(epoch from (t.clock_out - t.clock_in)) - app.lunch_seconds(t.id, t.clock_out)) / 3600.0, 2), w.name
    into v_over, v_who
  from public.tilldelning t
  join public.pass p   on p.id = t.pass_id
  join public.worker w on w.id = t.worker_id
  where p.project_id = p_project and p.work_date = p_work_date
    and p.deleted_at is null and t.released_at is null
    and t.confirmed_hours is null
    and t.clock_in is not null and t.clock_out is not null
    and (extract(epoch from (t.clock_out - t.clock_in)) - app.lunch_seconds(t.id, t.clock_out)) / 3600.0 > 99.99
  limit 1;

  if v_over is not null then
    raise exception 'the clock span for % on % is % hours; correct the stamps before surveying the day',
      v_who, p_work_date, round(v_over, 1) using errcode = 'check_violation';
  end if;

  -- Registered, not typed. Clock span where both ends exist; otherwise the
  -- planned figure, which for an auto-assigned arbetsledare is the envelope on
  -- their own row and for everyone else is the pass's.
  update public.tilldelning t
  set confirmed_hours = case
        when t.clock_in is not null and t.clock_out is not null
        then round((extract(epoch from (t.clock_out - t.clock_in)) - app.lunch_seconds(t.id, t.clock_out)) / 3600.0, 2)

        when t.source = 'ledare' and t.own_start is not null
        then round(extract(epoch from (
               (t.own_end - t.own_start)
               + case when t.own_end <= t.own_start
                      then interval '24 hours' else interval '0 hours' end
             )) / 3600.0, 2)

        else p.planned_hours
      end
  from public.pass p
  where p.id = t.pass_id
    and p.project_id = p_project and p.work_date = p_work_date
    and p.deleted_at is null and t.released_at is null
    and t.confirmed_hours is null;

  -- The day itself. confirmed_by, the stage and the late marks are the guard's.
  insert into public.project_day (project_id, work_date, vad_vi_gjorde,
                                  confirmed_at, confirmed_by, confirmed_via)
  values (p_project, p_work_date, btrim(p_text),
          now(), (select auth.uid()), 'bristsurvey')
  on conflict (project_id, work_date) do update
    set vad_vi_gjorde = btrim(p_text),
        confirmed_at  = now(),
        confirmed_by  = (select auth.uid()),
        confirmed_via = 'bristsurvey';
end $function$;

CREATE OR REPLACE FUNCTION public.bristsurvey_gaps(p_project uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project public.project;
  v_covered daterange := daterange(p_from, p_to + 1, '[)');
  v_missing text[] := '{}';
  v_leaders jsonb;
  v_days    jsonb;
  v_shifts  integer;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('project', p_project);
  if not app.is_admin() then
    raise exception 'only an admin runs a bristsurvey'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_project from public.project p where p.id = p_project;
  if v_project.id is null or v_project.deleted_at is not null then
    raise exception 'no such project' using errcode = 'check_violation';
  end if;

  -- The four cover values, in the order the document prints them.
  if btrim(v_project.name) = ''               then v_missing := v_missing || 'name'; end if;
  if btrim(v_project.bestallare_bolag) = ''   then v_missing := v_missing || 'bestallare_bolag'; end if;
  if btrim(v_project.bestallare_address) = '' then v_missing := v_missing || 'bestallare_address'; end if;
  if btrim(v_project.bestallare_orgnr) = ''   then v_missing := v_missing || 'bestallare_orgnr'; end if;

  select count(*) into v_shifts
  from public.pass p
  where p.project_id = p_project and p.deleted_at is null and p.work_date <@ v_covered;

  -- Who owed the confirmation. Named on screen so the admin can chase them
  -- instead of taking the day off them, which is the better outcome.
  select coalesce(jsonb_agg(d.name order by d.name), '[]'::jsonb) into v_leaders
  from public.project_leader pl
  join public.account_directory d on d.id = pl.account_id
  -- A nameless row would render as "null" on the chase screen. Every
  -- arbetsledare is also a worker and so has a name; one without is a broken
  -- account, and showing nothing beats showing a placeholder for a person.
  where pl.project_id = p_project and coalesce(d.active, false) and d.name is not null;

  -- One entry per day that is in the way, with what was registered on it.
  select coalesce(jsonb_agg(s.x order by s.x->>'work_date'), '[]'::jsonb) into v_days
  from (
    select jsonb_build_object(
      'work_date',     g.work_date,
      'needs_confirm', pd.confirmed_at is null,
      'needs_text',    pd.vad_vi_gjorde is null or btrim(pd.vad_vi_gjorde) = '',
      'vad_vi_gjorde', pd.vad_vi_gjorde,
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'worker', w.name,
                 'tider',  case
                             when t.clock_in is not null and t.clock_out is not null
                             then to_char(t.clock_in  at time zone 'Europe/Stockholm', 'HH24:MI')
                               || '-'
                               || to_char(t.clock_out at time zone 'Europe/Stockholm', 'HH24:MI')
                             else to_char(p.start_time, 'HH24:MI')
                               || '-' || to_char(p.end_time, 'HH24:MI')
                           end,
                 'timmar', case
                             when t.clock_in is not null and t.clock_out is not null
                             then round((extract(epoch from (t.clock_out - t.clock_in)) - app.lunch_seconds(t.id, t.clock_out)) / 3600.0, 2)
                             else p.planned_hours
                           end,
                 'stamplat', t.clock_in is not null and t.clock_out is not null
               ) order by w.name), '[]'::jsonb)
        from public.tilldelning t
        join public.pass p   on p.id = t.pass_id
        join public.worker w on w.id = t.worker_id
        where p.project_id = p_project and p.work_date = g.work_date
          and p.deleted_at is null and t.released_at is null
      )
    ) as x
    from (
      select distinct p.work_date
      from public.pass p
      where p.project_id = p_project and p.deleted_at is null and p.work_date <@ v_covered
    ) g
    left join public.project_day pd
      on pd.project_id = p_project and pd.work_date = g.work_date
    where pd.confirmed_at is null
       or pd.vad_vi_gjorde is null
       or btrim(pd.vad_vi_gjorde) = ''
  ) s;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id',                 v_project.id,
      'name',               v_project.name,
      'bestallare_bolag',   v_project.bestallare_bolag,
      'bestallare_address', v_project.bestallare_address,
      'bestallare_orgnr',   v_project.bestallare_orgnr,
      'missing',            to_jsonb(v_missing)
    ),
    'leaders',    v_leaders,
    'has_shifts', v_shifts > 0,
    'days',       v_days
  );
end $function$;
