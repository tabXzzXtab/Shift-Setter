-- ============================================================================
-- INVARIANT 10, tightened.
--
-- Was: confirmed hours are the only hours shown to a worker.
-- Now: a worker sees their hours for a period only once an Arbetsdagbok
--      covering that date has been GENERATED. The number shown is exactly what
--      was filed.
--
-- Confirmation alone is no longer enough. A confirmed day can still be edited
-- by the admin at stage two, or reopened; what has been filed into a document
-- cannot. So the document is the moment the number stops moving, and a number
-- that stops moving is the only kind worth showing -- the same reasoning that
-- put the original invariant there: "a number that shrinks when someone
-- corrects it is worse than no number".
--
-- The generation record IS the gate: a row in arbetsdagbok whose covered range
-- contains the day. Invariant 6 already guarantees such a row cannot exist over
-- an unconfirmed day, so filed implies confirmed and the two conditions do not
-- need to be checked separately -- but day_confirmed stays exposed so the
-- interface can tell "not confirmed yet" apart from "confirmed, not yet filed".
-- ============================================================================

create or replace view public.my_shift with (security_invoker = false) as
select
  t.id,
  t.pass_id,
  p.project_id,
  pr.name          as project_name,
  pr.site_address,
  p.work_date,
  p.start_time,
  p.end_time,
  p.planned_hours,
  t.clock_in,
  t.clock_out,
  -- Shown only once filed. Anything else is a figure that can still move.
  case
    when exists (
      select 1 from public.arbetsdagbok a
      where a.project_id = p.project_id and p.work_date <@ a.covered
    )
    then t.confirmed_hours
  end as confirmed_hours,
  (pd.confirmed_at is not null) as day_confirmed,
  -- So the worker can be told which of the two is true, rather than being left
  -- with a blank and no reason for it.
  exists (
    select 1 from public.arbetsdagbok a
    where a.project_id = p.project_id and p.work_date <@ a.covered
  ) as filed
from public.tilldelning t
join public.pass p     on p.id = t.pass_id  and p.deleted_at is null
join public.project pr on pr.id = p.project_id and pr.deleted_at is null   -- INVARIANT 8
left join public.project_day pd
       on pd.project_id = p.project_id and pd.work_date = p.work_date
where t.released_at is null
  and t.worker_id = app.current_worker_id();

-- The worker reads this view and never the table, so the range lookup runs on
-- every load of Mina pass.
create index if not exists arbetsdagbok_project_covered_idx
  on public.arbetsdagbok using gist (project_id, covered);
