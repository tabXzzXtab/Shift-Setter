-- ============================================================================
-- LEDARENS TIDER ÄR LEDARENS RAD -- stage 2 corrects a leader's own span.
--
-- Step 4b places an arbetsledare on a day because their people were there. The
-- span that row carries is the workers' ENVELOPE, computed per project, and it
-- lives on the assignment as own_start/own_end -- not on the pass, which is
-- when the job ran and belongs to everybody standing on it.
--
-- approve_day() only ever wrote times to public.pass. So an admin correcting
-- the leader's hours at stage 2 either could not touch their times at all, or
-- would have moved every worker on the shift to do it. Neither is a
-- correction; the first is a gap and the second is damage.
--
-- THE ROUTING IS DECIDED HERE, NOT BY THE CALLER. The row already names the
-- tilldelning, so the function can read its source and choose the destination
-- itself. A client that sent a leader's times with a `pass` key cannot write
-- them to the pass, and one that omitted the key cannot fail to write them at
-- all. The interface is decorative (CLAUDE.md); this is the boundary.
--
-- WHY STAGE 2 AND NOT STAGE 1. The leader's times stop being editable on
-- Bekräfta Pass in the same change as this: a person stating when they
-- personally were on site, on the row that pays them, is the one conflict of
-- interest the two-stage system exists to hold. Their HOURS stay theirs to
-- type -- lunch comes off the envelope and nobody else knows how long it was
-- (invariant 1). Times are the claim somebody else checks; hours are the claim
-- they make. This function is where the checking happens.
--
-- confirm_flagged_day() is deliberately untouched. It writes hours and no
-- times, and a flagged day is by definition one that ran with a worker as
-- ansvarig or with nobody -- so there is no arbetsledare row on it to route.
-- ============================================================================

create or replace function public.approve_day(
  p_project   uuid,
  p_work_date date,
  p_text      text  default null,
  p_rows      jsonb default '[]'::jsonb
) returns void
  language plpgsql
  set search_path = ''
as $fn$
declare
  v_stage public.day_stage;
  r       jsonb;
  v_ledare boolean;
begin
  if not app.is_admin() then
    raise exception 'only the admin reviews a confirmed day'
      using errcode = 'insufficient_privilege';
  end if;

  select pd.stage into v_stage
  from public.project_day pd
  where pd.project_id = p_project and pd.work_date = p_work_date;

  if v_stage is distinct from 'leader_confirmed' then
    raise exception 'only a day the arbetsledare has confirmed can be approved'
      using errcode = 'check_violation';
  end if;

  -- The corrections first, while the day is still open to them.
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if r ? 'hours' then
      update public.tilldelning t
      set confirmed_hours = (r->>'hours')::numeric
      from public.pass p
      where t.id = (r->>'tilldelning')::uuid
        and p.id = t.pass_id
        and p.project_id = p_project and p.work_date = p_work_date;
    end if;

    if (r ? 'start') and (r ? 'end') then
      -- Which row is this? Read from the assignment named in the payload, and
      -- scoped to the day being approved -- an id from some other project
      -- resolves to nothing and writes nothing, here as in the hours update.
      select t.source = 'ledare' into v_ledare
      from public.tilldelning t
      join public.pass p on p.id = t.pass_id
      where t.id = (r->>'tilldelning')::uuid
        and p.project_id = p_project and p.work_date = p_work_date;

      if coalesce(v_ledare, false) then
        -- The leader's own span, on the leader's own row. Writing it to the
        -- pass would move every worker on that shift, and the admin is
        -- correcting when the LEADER was there, not when the job ran.
        update public.tilldelning t
        set own_start = (r->>'start')::time,
            own_end   = (r->>'end')::time
        from public.pass p
        where t.id = (r->>'tilldelning')::uuid
          and p.id = t.pass_id
          and p.project_id = p_project and p.work_date = p_work_date;
      else
        update public.pass p
        set start_time = (r->>'start')::time, end_time = (r->>'end')::time
        where p.id = (r->>'pass')::uuid
          and p.project_id = p_project and p.work_date = p_work_date
          and p.deleted_at is null;
      end if;
    end if;
  end loop;

  update public.project_day pd
  set vad_vi_gjorde = coalesce(nullif(btrim(p_text), ''), pd.vad_vi_gjorde),
      stage         = 'admin_confirmed'
  where pd.project_id = p_project and pd.work_date = p_work_date;
end $fn$;
