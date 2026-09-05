-- ============================================================================
-- BYTA PLATS MED ARBETSLEDARE -- two leaders trade days.
--
-- Not Step 5c. Nobody is being taken off anything: both leaders keep a day,
-- they simply keep each other's. So NEITHER DAY IS FLAGGED -- a flag records a
-- supervision gap, and there is no gap here. Every project involved still has
-- an arbetsledare on it when this is done, which is the whole difference
-- between a planned swap and somebody dropping out.
--
-- THE ENVELOPE FOLLOWS THE PROJECT, NOT THE PERSON. Each leader's row carries
-- own_start/own_end computed from the workers on THAT project that day, so
-- after the swap each of them holds the other project's envelope -- which is
-- the point: they are covering a different site with different people on it.
-- The rows keep their project and their pass; what moves between them is who
-- is standing there.
--
-- WHY THE ROWS ARE REPLACED RATHER THAN EDITED. app.sync_leader_day() puts a
-- project's OWN leaders back on any day their people are working, and it
-- treats exactly one thing as a decision not to: a row released as
-- 'removed_by_leader'. Swapping by rewriting worker_id would leave no such
-- record, and the next edit to either day's roster would quietly re-place both
-- leaders on their original projects -- on top of the swap. So each side is
-- released the way a removal is released, and the replacement row is inserted
-- behind it.
--
-- ADMIN ONLY. A swap moves somebody else's day as well as your own.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WHO COULD BE SWAPPED WITH
--
-- The other arbetsledare working that same day on a DIFFERENT project. Not
-- "available" in the sense of free -- a free leader is Step 5c's replacement
-- list. A swap needs somebody who already has a day to trade.
-- ---------------------------------------------------------------------------
create or replace function public.swap_partners(p_tilldelning uuid)
returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $fn$
declare
  v_row     public.tilldelning;
  v_name    text;
  v_project text;
  v_others  jsonb;
begin
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null or v_row.source <> 'ledare' or v_row.released_at is not null then
    raise exception 'that is not an arbetsledare''s day' using errcode = 'check_violation';
  end if;

  if not app.is_admin() then
    raise exception 'only an admin swaps two arbetsledare'
      using errcode = 'insufficient_privilege';
  end if;

  select w.name into v_name from public.worker w where w.id = v_row.worker_id;
  select pr.name into v_project from public.project pr where pr.id = v_row.project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tilldelning',  c.id,
           'worker_id',    c.worker_id,
           'name',         c.name,
           'project_id',   c.project_id,
           'project_name', c.project_name,
           'start_time',   to_char(c.own_start, 'HH24:MI'),
           'end_time',     to_char(c.own_end,   'HH24:MI')
         ) order by c.project_name, c.name), '[]'::jsonb)
    into v_others
  from (
    select t.id, t.worker_id, t.project_id, t.own_start, t.own_end,
           w.name, pr.name as project_name
    from public.tilldelning t
    join public.worker  w  on w.id = t.worker_id and w.deleted_at is null
    join public.project pr on pr.id = t.project_id and pr.deleted_at is null
    where t.work_date   = v_row.work_date
      and t.source      = 'ledare'
      and t.released_at is null
      -- Says what the list is for. It has no independent effect and there is
      -- deliberately no negative control for it: two leaders on ONE project
      -- both hold a row on it, so the overlap test below already excludes
      -- them, and so does it exclude this row itself. Kept because a reader
      -- should not have to derive "a swap is with another project" from two
      -- NOT EXISTS clauses.
      and t.project_id <> v_row.project_id
      -- Neither of them may already hold the other's project that day, or the
      -- swap would give somebody two rows on one project.
      and not exists (
        select 1 from public.tilldelning x
        where x.worker_id = t.worker_id and x.work_date = t.work_date
          and x.project_id = v_row.project_id
          and x.source = 'ledare' and x.released_at is null
      )
      and not exists (
        select 1 from public.tilldelning y
        where y.worker_id = v_row.worker_id and y.work_date = t.work_date
          and y.project_id = t.project_id
          and y.source = 'ledare' and y.released_at is null
      )
  ) c;

  return jsonb_build_object(
    'tilldelning',  v_row.id,
    'leader_name',  v_name,
    'project_name', v_project,
    'work_date',    v_row.work_date,
    'partners',     v_others
  );
end $fn$;

-- ---------------------------------------------------------------------------
-- 2. THE SWAP
-- ---------------------------------------------------------------------------
create or replace function public.swap_leaders(p_a uuid, p_b uuid)
returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  a public.tilldelning;
  b public.tilldelning;
begin
  if not app.is_admin() then
    raise exception 'only an admin swaps two arbetsledare'
      using errcode = 'insufficient_privilege';
  end if;

  select t.* into a from public.tilldelning t where t.id = p_a;
  select t.* into b from public.tilldelning t where t.id = p_b;

  if a.id is null or b.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;
  if a.source <> 'ledare' or b.source <> 'ledare' then
    raise exception 'both sides of a swap must be an arbetsledare''s day'
      using errcode = 'check_violation';
  end if;
  if a.released_at is not null or b.released_at is not null then
    raise exception 'one of those days is already given up'
      using errcode = 'check_violation';
  end if;
  if a.work_date <> b.work_date then
    raise exception 'a swap is two arbetsledare trading the SAME day'
      using errcode = 'check_violation';
  end if;
  if a.project_id = b.project_id then
    raise exception 'both are already on that project; there is nothing to trade'
      using errcode = 'check_violation';
  end if;
  if a.worker_id = b.worker_id then
    raise exception 'that is the same arbetsledare on both sides'
      using errcode = 'check_violation';
  end if;

  -- Already on the other's project that day: the swap would give them two rows
  -- on one project, which the index forbids and which means nothing anyway.
  if exists (select 1 from public.tilldelning t
             where t.worker_id = a.worker_id and t.work_date = a.work_date
               and t.project_id = b.project_id
               and t.source = 'ledare' and t.released_at is null)
     or exists (select 1 from public.tilldelning t
                where t.worker_id = b.worker_id and t.work_date = b.work_date
                  and t.project_id = a.project_id
                  and t.source = 'ledare' and t.released_at is null) then
    raise exception 'one of them already leads the other''s project that day'
      using errcode = 'check_violation';
  end if;

  -- Released as a removal, because that is the one thing sync_leader_day reads
  -- as "a person decided this". Without it the next roster edit on either day
  -- puts both of them back on their own projects, on top of the swap.
  update public.tilldelning t
  set released_at = now(), released_reason = 'removed_by_leader',
      released_by = (select auth.uid())
  where t.id in (p_a, p_b);

  -- Each replacement keeps the ROW's project, pass and envelope, and changes
  -- only who is standing there. That is what makes own_start/own_end come out
  -- as the new project's span without anything having to recompute it.
  insert into public.tilldelning
    (pass_id, worker_id, source, work_date, project_id, own_start, own_end)
  values
    (a.pass_id, b.worker_id, 'ledare', a.work_date, a.project_id, a.own_start, a.own_end),
    (b.pass_id, a.worker_id, 'ledare', b.work_date, b.project_id, b.own_start, b.own_end);

  -- Neither of them asked for it, so neither should have to find out by
  -- looking. Each is told which project they are on now.
  insert into public.notification (account_id, kind, payload)
  select w.account_id, 'leader_replaced',
         jsonb_build_object(
           'work_date', a.work_date,
           'swapped', true,
           'project_id', case when w.id = a.worker_id then b.project_id else a.project_id end)
  from public.worker w
  where w.id in (a.worker_id, b.worker_id) and w.account_id is not null;
end $fn$;

grant execute on function public.swap_partners(uuid) to authenticated;
grant execute on function public.swap_leaders(uuid, uuid) to authenticated;
