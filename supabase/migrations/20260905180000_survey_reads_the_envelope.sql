-- ============================================================================
-- The bristsurvey reads an arbetsledare's own span.
--
-- Step 4b gave the auto-assigned leader a row whose times are the workers'
-- ENVELOPE, carried on the row as own_start/own_end, because the row hangs on
-- whichever pass happened to start first and that pass's times are not the
-- leader's day. Bekräfta Pass reads it there. The Arbetsdagbok prints it from
-- there. The bristsurvey did not: its planned-figure fallback took
-- p.planned_hours off the pass, so a day reconstructed by the admin gave the
-- leader somebody else's hours -- and then froze them into a legal document,
-- which is the one thing that path exists to get right.
--
-- NO BREAK COMES OFF IT, which is the same rule the confirmation screen
-- follows: a leader's figure is the whole span, and lunch is theirs to
-- subtract. The survey subtracts nothing from anyone -- it takes what was
-- registered -- so the envelope goes in whole.
--
-- The envelope can cross midnight, because a night shift is a real shift and
-- min(start) 22:00 with max(end) 06:00 is eight hours rather than minus
-- sixteen. Same correction app.pass_end_at makes, made here on the interval.
-- ============================================================================

create or replace function public.complete_bristsurvey(
  p_project   uuid,
  p_work_date date,
  p_text      text
) returns void
  language plpgsql
  set search_path = ''
as $fn$
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
  select round(extract(epoch from (t.clock_out - t.clock_in)) / 3600.0, 2), w.name
    into v_over, v_who
  from public.tilldelning t
  join public.pass p   on p.id = t.pass_id
  join public.worker w on w.id = t.worker_id
  where p.project_id = p_project and p.work_date = p_work_date
    and p.deleted_at is null and t.released_at is null
    and t.confirmed_hours is null
    and t.clock_in is not null and t.clock_out is not null
    and extract(epoch from (t.clock_out - t.clock_in)) / 3600.0 > 99.99
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
        then round(extract(epoch from (t.clock_out - t.clock_in)) / 3600.0, 2)

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
end $fn$;
