-- ============================================================================
-- SNABB PASS FILES THE DAY ITSELF -- WHEN IT IS THE ONLY THING ON IT
--
-- Until now a Snabb Pass skipped the picking and never the confirming: the
-- admin put somebody on site, and the day then waited for the arbetsledare
-- like any other. That is still what happens by default, and it is still
-- right for a day the leader was running anyway.
--
-- What it could not do is the case it exists for. Somebody drops out at
-- seven, the admin rings a replacement, that person works the day alone, and
-- there is nothing for a leader to confirm because no leader was there --
-- only an admin who arranged the whole thing and knows the hours. Making that
-- day wait produced a queue entry nobody could honestly answer.
--
-- So the admin now chooses at creation time, and the screen calls it
-- "Generera arbetsdagbok direkt":
--
--   FÖRE bekräftelse -- the day is filed as the admin states it. Straight to
--   admin_confirmed, confirmed_via = 'snabb', never into a review queue. The
--   Arbetsdagbok can be generated the same minute.
--
--   EFTER bekräftelse -- unchanged behaviour, plus a notification. The day
--   waits for the arbetsledare, who confirms it at stage 1, and the admin
--   approves at stage 2.
--
-- ----------------------------------------------------------------------------
-- FOUR THINGS FÖRE REFUSES, AND WHY EACH ONE IS NOT NEGOTIABLE
--
-- 1. IT MUST BE THE ONLY SHIFT ON THAT PROJECT THAT DATE.
--    project_day's primary key is (project_id, work_date): a confirmation is
--    a statement about a DAY, not about a row. Filing a Snabb Pass on a day
--    four other people are already working would confirm their hours too --
--    figures nobody stated, locked by invariant 5 against the leader who was
--    about to state them. So Före is offered only where the question does not
--    arise, and the screen says so before the admin commits to it. It also
--    keeps the escape hatch open: because Före never closes a day that has
--    other people on it, a second dropout the same day is still bookable.
--
-- 2. THE DAY MUST BE TODAY OR EARLIER.
--    This is the one place the "not over yet" guard gives way, and only
--    backwards. A Snabb Pass is booked after the fact by construction -- the
--    admin is recording at eleven what was arranged at seven -- and making
--    them come back at four to file a day they already know the whole of is
--    the waiting this route removes. Forwards it still refuses: the
--    Arbetsdagbok states work that was DONE, and a day that has not happened
--    has no hours to state however confident anyone is about them. Today or
--    earlier is a claim about the past; tomorrow is a plan.
--
-- 3. THE DAY NEEDS ITS "VAD VI GJORDE".
--    Invariant 6, and it is a table CHECK as well as the document's own
--    guard. A day cannot be confirmed with the cell empty, so Före asks for
--    the text on the Snabb Pass screen rather than producing a confirmed day
--    that no document can be generated from.
--
-- 4. EVERY ARBETSLEDARE ON THE DAY NEEDS AN ACCEPTED FIGURE.
--    app.sync_leader_day() puts a source='ledare' row on the day the moment
--    anyone lands on it, and that row is paid. Invariant 1: an auto-assigned
--    arbetsledare's hours are prefilled and STAY EDITABLE AT EVERY STAGE,
--    because a number a human must accept or correct is not a derived number.
--    Före closes the day, so there is no later stage in which to correct it
--    -- which means the acceptance has to happen here. p_ledare carries the
--    figures the admin saw and accepted on screen, and the day is refused if
--    any leader row is still missing one. The letter of invariant 1 gives way
--    (there is no "every stage" left); its reason does not -- a human still
--    accepts the figure before it is filed, and it is never computed behind
--    their back.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE GUARD LEARNS THE FOURTH ROUTE
--
-- Two changes to the live definition, and everything else is byte-for-byte
-- what was there -- including the app.leads_project/app.holds_the_day test
-- kept on ONE line, which a negative control greps the stored body for.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tg_confirmation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_last_end   timestamptz;
  v_missing    integer;
  v_claim_moved boolean;
begin
  if tg_op = 'DELETE' then
    if old.confirmed_at is not null then
      raise exception 'a confirmed day cannot be deleted'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  -- ==========================================================================
  -- STAGE 2 -- the day already carries a confirmation.
  -- ==========================================================================
  if tg_op = 'UPDATE' and old.confirmed_at is not null then

    -- INVARIANT 5, the second wall. Terminal means terminal.
    if old.stage = 'admin_confirmed' then
      raise exception 'day % on project % is admin_confirmed and final; nothing edits it',
        old.work_date, old.project_id using errcode = 'insufficient_privilege';
    end if;

    -- INVARIANT 5, the first wall. Stage 1 is final FOR THE LEADER: the only
    -- thing that puts the day back in their hands is the admin rejecting it.
    if not app.is_admin() then   -- stage 2 is the admin's alone
      raise exception 'day % is confirmed; stage 1 is final -- only the admin reviews it',
        old.work_date using errcode = 'insufficient_privilege';
    end if;

    -- How the day RAN is not something reviewing it can change.
    new.flagged_as         := old.flagged_as;
    new.ansvarig_worker_id := old.ansvarig_worker_id;

    -- REVIEWING A CLAIM IS NOT MAKING ONE. Whatever the outcome, the
    -- confirmation under review stays attributed to whoever made it.
    v_claim_moved := new.confirmed_at  is distinct from old.confirmed_at
                  or new.confirmed_by  is distinct from old.confirmed_by
                  or new.confirmed_via is distinct from old.confirmed_via;

    if v_claim_moved and new.stage is not null then
      raise exception 'stage 2 reviews a confirmation; it cannot rewrite whose it was'
        using errcode = 'insufficient_privilege';
    end if;

    if new.stage is null then
      -- ---- REJECT AND SEND BACK. The only route that reopens a day. --------
      if new.rejection_note is null or btrim(new.rejection_note) = '' then
        raise exception 'a rejected day needs a note saying what is wrong'
          using errcode = 'check_violation';
      end if;

      new.confirmed_at   := null;
      new.confirmed_by   := null;
      new.confirmed_via  := null;
      new.reviewed_at    := null;
      new.reviewed_by    := null;
      new.rejection_note := btrim(new.rejection_note);
      new.rejected_at    := now();
      new.rejected_by    := (select auth.uid());

      insert into public.day_review (project_id, work_date, action, note, acted_by)
      values (new.project_id, new.work_date, 'rejected', new.rejection_note,
              (select auth.uid()));

      return new;

    elsif new.stage = 'admin_confirmed' then
      -- ---- APPROVE, with or without the admin's corrections. ---------------
      if new.vad_vi_gjorde is null or btrim(new.vad_vi_gjorde) = '' then
        raise exception 'a day cannot be approved with no account of what was done'
          using errcode = 'check_violation';
      end if;

      select count(*) into v_missing
      from public.tilldelning t
      join public.pass p on p.id = t.pass_id
      where p.project_id = new.project_id and p.work_date = new.work_date
        and p.deleted_at is null and t.released_at is null
        and t.confirmed_hours is null;

      if v_missing > 0 then
        raise exception '% assignment(s) on % still have no confirmed hours',
          v_missing, new.work_date using errcode = 'check_violation';
      end if;

      new.rejected_at    := old.rejected_at;
      new.rejected_by    := old.rejected_by;
      new.rejection_note := old.rejection_note;
      new.reviewed_at    := now();
      new.reviewed_by    := (select auth.uid());

      insert into public.day_review (project_id, work_date, action, acted_by)
      values (new.project_id, new.work_date, 'approved', (select auth.uid()));

      return new;
    end if;

    -- ---- Neither. An edit that leaves the day where it is. -----------------
    new.stage          := old.stage;
    new.reviewed_at    := old.reviewed_at;
    new.reviewed_by    := old.reviewed_by;
    new.rejected_at    := old.rejected_at;
    new.rejected_by    := old.rejected_by;
    new.rejection_note := old.rejection_note;
    return new;
  end if;

  -- ==========================================================================
  -- STAGE 1 -- and the routes that reach admin_confirmed with no leader.
  -- ==========================================================================

  -- The review axis is stage 2's alone.
  if tg_op = 'INSERT' then
    new.reviewed_at := null; new.reviewed_by := null;
    new.rejected_at := null; new.rejected_by := null; new.rejection_note := null;
  else
    new.reviewed_at    := old.reviewed_at;
    new.reviewed_by    := old.reviewed_by;
    new.rejected_at    := old.rejected_at;
    new.rejected_by    := old.rejected_by;
    new.rejection_note := old.rejection_note;

    -- The flag may be SET while the day is open -- that write is Step 5c
    -- itself -- but the write that closes the day may not move it. Otherwise
    -- confirming a day would be a way to forget how it ran.
    if new.confirmed_at is not null then
      new.flagged_as         := old.flagged_as;
      new.ansvarig_worker_id := old.ansvarig_worker_id;
    end if;
  end if;

  -- Writing the "Vad Vi Gjorde" text is the leader's on their own projects, and
  -- the admin's when filling a bristsurvey. Confirming is narrower -- below.
  -- Or you are the arbetsledare STANDING on this project this day. After a
  -- swap (Step 5d) that is somebody with no standing membership at all, and
  -- refusing them here would refuse the only person who was there.
  -- Kept on ONE LINE deliberately: this is what a negative control has to
  -- find in the stored body, and a stored body carries whatever line
  -- endings the migration file had.
  if not (app.leads_project(new.project_id) or app.holds_the_day(new.project_id, new.work_date)) then
    raise exception 'not your project'
      using errcode = 'insufficient_privilege';
  end if;

  if new.confirmed_at is null then
    new.stage := null;
  else
    -- WHO CLOSED THE DAY, AND BY WHICH ROUTE.
    if new.confirmed_via = 'leader' then
      -- INVARIANT 4b, its last line. A day that ran with a worker covering, or
      -- with nobody, has no leader claim in it to make -- not by the project's
      -- other leaders, and not by the one who was taken off it.
      if new.flagged_as is not null then
        raise exception 'day % ran without an arbetsledare; admin and only admin confirms it',
          new.work_date using errcode = 'insufficient_privilege';
      end if;

      if not app.confirms_project(new.project_id, new.work_date) then
        raise exception 'only the arbetsledare who held day % on this project may confirm it; the admin fills gaps through the bristsurvey', new.work_date
          using errcode = 'insufficient_privilege';
      end if;
      new.stage := 'leader_confirmed';

    elsif new.confirmed_via = 'bristsurvey' then
      if not app.is_admin() then
        raise exception 'only an admin completes a bristsurvey'
          using errcode = 'insufficient_privilege';
      end if;
      new.stage := 'admin_confirmed';

    elsif new.confirmed_via in ('worker_ansvarig', 'ingen_ledare') then
      -- The same shape as the bristsurvey: no stage 1 behind it, so the day is
      -- written straight to admin_confirmed and never enters a review queue.
      if not app.is_admin() then
        raise exception 'a flagged day is confirmed by the admin and nobody else'
          using errcode = 'insufficient_privilege';
      end if;
      -- And only as what it actually was.
      if new.flagged_as is distinct from new.confirmed_via then
        raise exception 'day % is not flagged as %; it cannot be confirmed as one',
          new.work_date, new.confirmed_via using errcode = 'check_violation';
      end if;
      new.stage := 'admin_confirmed';

    elsif new.confirmed_via = 'snabb' then
      -- THE FOURTH ROUTE. The admin arranged the day themselves -- rang
      -- somebody that morning, put them on site, and is stating the hours
      -- they agreed. There is no leader claim behind it and there never will
      -- be, which is the same shape as the bristsurvey: straight to
      -- admin_confirmed, never into a review queue.
      --
      -- It is NOT a flag. A flagged day is one nobody was answerable for; a
      -- snabb day has whoever leads the project standing on it, and saying
      -- otherwise in the record would be the wrong admission.
      if not app.is_admin() then
        raise exception 'only an admin files a Snabb Pass day'
          using errcode = 'insufficient_privilege';
      end if;

      if new.flagged_as is not null then
        raise exception 'day % ran without an arbetsledare; it is confirmed as what it was, not as a Snabb Pass',
          new.work_date using errcode = 'insufficient_privilege';
      end if;

      new.stage := 'admin_confirmed';

    else
      raise exception 'a confirmed day must record how it was confirmed'
        using errcode = 'check_violation';
    end if;

    -- Step 8: confirmable the minute its last shift has ended.
    select max(app.pass_end_at(p.work_date, p.start_time, p.end_time)) into v_last_end
    from public.pass p
    where p.project_id = new.project_id and p.work_date = new.work_date
      and p.deleted_at is null;

    if v_last_end is null then
      raise exception 'no shifts on % for this project; nothing to confirm', new.work_date
        using errcode = 'check_violation';
    end if;

    -- Step 8: confirmable the minute its last shift has ended -- and the
    -- snabb route is the ONE exception, backwards only.
    --
    -- A Snabb Pass is booked after the fact by construction: somebody dropped
    -- out this morning, a replacement stood there, and the admin is recording
    -- it at eleven. Making them come back at four to file a day they already
    -- know the whole of is the waiting this route exists to remove.
    --
    -- FORWARDS IT STILL REFUSES, and that is not a detail. The Arbetsdagbok is
    -- a statement about work that was done; a day that has not happened has no
    -- hours to state, however confident anybody is about them. Today or
    -- earlier is a claim about the past. Tomorrow is a plan.
    if new.confirmed_via = 'snabb' then
      if new.work_date > app.stockholm_today() then
        raise exception 'day % has not happened yet; a Snabb Pass cannot file it in advance',
          new.work_date using errcode = 'check_violation';
      end if;
    elsif now() < v_last_end then
      raise exception 'day % is not over yet; its last shift ends %', new.work_date, v_last_end
        using errcode = 'check_violation';
    end if;

    -- Section 9: NULL means not confirmed, 0 means confirmed no-show.
    select count(*) into v_missing
    from public.tilldelning t
    join public.pass p on p.id = t.pass_id
    where p.project_id = new.project_id and p.work_date = new.work_date
      and p.deleted_at is null and t.released_at is null
      and t.confirmed_hours is null;

    if v_missing > 0 then
      raise exception '% assignment(s) on % still have no confirmed hours',
        v_missing, new.work_date using errcode = 'check_violation';
    end if;

    new.confirmed_by := (select auth.uid());

    update public.worker w
    set late_marks = w.late_marks + 1
    where w.id in (
      select t.worker_id from public.tilldelning t
      join public.pass p on p.id = t.pass_id
      where p.project_id = new.project_id and p.work_date = new.work_date
        and p.deleted_at is null and t.released_at is null and t.late
    );
  end if;

  return new;
end $function$;
-- ----------------------------------------------------------------------------
-- 2. THE RPC TAKES THE CHOICE
--
-- Dropped and recreated rather than overloaded: two functions of the same
-- name, one of which quietly kept the old behaviour, is the kind of pair that
-- drifts. The three arguments are defaulted so the shape stays forgiving, and
-- p_direkt defaults to FALSE -- the safe mode is the one you get by omission.
-- scripts/test-db.mjs pins the old signature in three negative controls and is
-- updated in the same commit.
-- ----------------------------------------------------------------------------
drop function if exists public.create_snabb_pass(uuid, uuid, date, time, time, numeric);

create function public.create_snabb_pass(
  p_project uuid,
  p_worker  uuid,
  p_date    date,
  p_start   time,
  p_end     time,
  p_hours   numeric,
  p_direkt  boolean default false,
  p_text    text    default null,
  p_ledare  jsonb   default '[]'::jsonb
) returns uuid
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_pass    uuid;
  v_name    text;
  v_stuck   text;
  v_other   integer;
  v_missing text;
  r         jsonb;
begin
  if not app.is_admin() then
    raise exception 'only an admin creates a Snabb Pass' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.project p where p.id = p_project and p.deleted_at is null
  ) then
    raise exception 'no such project' using errcode = 'check_violation';
  end if;

  select w.name into v_name
  from public.worker w where w.id = p_worker and w.deleted_at is null;
  if v_name is null then
    raise exception 'no such worker' using errcode = 'check_violation';
  end if;

  -- ASKED BEFORE ANYTHING IS WRITTEN. A day that reached admin_confirmed is
  -- final under invariant 5, and that is not a rule Snabb Pass gets to bend --
  -- those hours are already in an Arbetsdagbok. Refusing in the admin's own
  -- language beats letting a trigger three levels down do it in the
  -- database's.
  select pr.name || ' ' || to_char(p.start_time, 'HH24:MI')
                 || '-' || to_char(p.end_time, 'HH24:MI')
    into v_stuck
  from public.tilldelning t
  join public.pass p       on p.id = t.pass_id and p.deleted_at is null
  join public.project pr   on pr.id = p.project_id
  join public.project_day pd on pd.project_id = p.project_id and pd.work_date = p.work_date
  where t.worker_id   = p_worker
    and t.released_at is null
    and t.source     <> 'ledare'
    and t.work_date between p_date - 1 and p_date + 1
    and pd.stage = 'admin_confirmed'
    and app.pass_start_at(p.work_date, p.start_time) < app.pass_end_at(p_date, p_start, p_end)
    and app.pass_start_at(p_date, p_start) < app.pass_end_at(p.work_date, p.start_time, p.end_time)
  limit 1;

  if v_stuck is not null then
    raise exception
      '% har ett pass som krockar (%) och den dagen är redan bekräftad och låst. Ändra tiderna eller välj en annan person.',
      v_name, v_stuck
      using errcode = 'insufficient_privilege';
  end if;

  -- ==========================================================================
  -- FÖRE BEKRÄFTELSE -- everything this route refuses, asked before the write.
  -- All three say what is wrong and what to do instead, because the admin is
  -- standing on a screen with a toggle and the answer is always "turn it off".
  -- ==========================================================================
  if p_direkt then
    select count(*) into v_other
    from public.pass p
    where p.project_id = p_project and p.work_date = p_date
      and p.deleted_at is null;

    if v_other > 0 then
      raise exception
        'Det står redan % pass på det här projektet den %. En dag med fler personer på bekräftas av arbetsledaren — stäng av "Generera arbetsdagbok direkt" så läggs passet till dagen som vanligt.',
        v_other, p_date
        using errcode = 'check_violation';
    end if;

    if p_date > app.stockholm_today() then
      raise exception
        'Den % har inte varit än. Ett pass kan bara föras rakt in i arbetsdagboken i efterhand — välj dagens datum eller tidigare, eller stäng av "Generera arbetsdagbok direkt".',
        p_date
        using errcode = 'check_violation';
    end if;

    if p_text is null or btrim(p_text) = '' then
      raise exception
        'Dagen behöver en beskrivning av vad som gjordes innan den kan föras in i arbetsdagboken. Fyll i "Vad vi gjorde".'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.pass (project_id, work_date, start_time, end_time,
                           planned_hours, headcount, created_by)
  values (p_project, p_date, p_start, p_end, p_hours, 1, (select auth.uid()))
  returning id into v_pass;

  -- ONLY WHAT IT COLLIDES WITH. A morning shift and an afternoon Snabb Pass
  -- are two things that happened, and the Arbetsdagbok has a row for each.
  update public.tilldelning t
  set released_at = now(), released_reason = 'replaced_by_snabb',
      released_by = (select auth.uid())
  from public.pass p
  where p.id = t.pass_id and p.deleted_at is null
    and t.worker_id   = p_worker
    and t.released_at is null
    and t.source     <> 'ledare'          -- never takes a leader off their day
    and t.work_date between p_date - 1 and p_date + 1
    and app.pass_start_at(p.work_date, p.start_time) < app.pass_end_at(p_date, p_start, p_end)
    and app.pass_start_at(p_date, p_start) < app.pass_end_at(p.work_date, p.start_time, p.end_time);

  -- The hours the admin typed ARE the confirmed figure on this route: there is
  -- no leader coming along afterwards to state one. On the Efter route the
  -- column stays null and the leader fills it, exactly as before.
  insert into public.tilldelning (pass_id, worker_id, source, work_date, confirmed_hours)
  values (v_pass, p_worker, 'snabb', p_date,
          case when p_direkt then p_hours end);

  if not p_direkt then
    -- EFTER BEKRÄFTELSE. The day waits for the arbetsledare as it always has.
    -- The notification is the only new thing: a Snabb Pass is somebody added
    -- to their day without them, and a leader should not have to notice it.
    insert into public.notification (account_id, kind, payload)
    select pl.account_id, 'snabb_review',
           jsonb_build_object('project_id', p_project,
                              'work_date', p_date,
                              'worker', v_name)
    from public.project_leader pl
    join public.account a on a.id = pl.account_id and a.active
    where pl.project_id = p_project;

    return v_pass;
  end if;

  -- ==========================================================================
  -- FÖRE BEKRÄFTELSE -- the day is closed here, and nothing reopens it.
  -- ==========================================================================

  -- The arbetsledare rows app.sync_leader_day() just created, at the figures
  -- the admin accepted on screen. Matched on worker_id because the assignment
  -- ids did not exist when the screen drew the field.
  for r in select * from jsonb_array_elements(coalesce(p_ledare, '[]'::jsonb)) loop
    update public.tilldelning t
    set confirmed_hours = (r->>'hours')::numeric
    where t.project_id  = p_project
      and t.work_date   = p_date
      and t.source      = 'ledare'
      and t.released_at is null
      and t.worker_id   = (r->>'worker')::uuid;
  end loop;

  -- A row with no figure is a row nobody accepted. The guard would refuse the
  -- confirmation anyway; it would do it by counting, and a count does not tell
  -- the admin whose field they left empty.
  select string_agg(w.name, ', ' order by w.name) into v_missing
  from public.tilldelning t
  join public.pass p   on p.id = t.pass_id and p.deleted_at is null
  join public.worker w on w.id = t.worker_id
  where p.project_id = p_project and p.work_date = p_date
    and t.released_at is null
    and t.confirmed_hours is null;

  if v_missing is not null then
    raise exception
      'Timmar saknas för %. Varje person på dagen behöver en siffra innan dagen förs in i arbetsdagboken.',
      v_missing
      using errcode = 'check_violation';
  end if;

  insert into public.project_day (project_id, work_date, vad_vi_gjorde,
                                  confirmed_at, confirmed_by, confirmed_via)
  values (p_project, p_date, btrim(p_text),
          now(), (select auth.uid()), 'snabb')
  on conflict (project_id, work_date) do update
    set vad_vi_gjorde = btrim(p_text),
        confirmed_at  = now(),
        confirmed_by  = (select auth.uid()),
        confirmed_via = 'snabb';

  return v_pass;
end $fn$;

grant execute on function public.create_snabb_pass(
  uuid, uuid, date, time, time, numeric, boolean, text, jsonb
) to authenticated;

comment on function public.create_snabb_pass(
  uuid, uuid, date, time, time, numeric, boolean, text, jsonb
) is
  'Snabb Pass. p_direkt = false (the default) leaves the day to the '
  'arbetsledare and notifies them. p_direkt = true files the day itself as '
  'confirmed_via = ''snabb'' -- allowed only when the pass is alone on that '
  'project-date, the date is today or earlier, the day carries a "Vad Vi '
  'Gjorde", and every arbetsledare row has an accepted hours figure.';
