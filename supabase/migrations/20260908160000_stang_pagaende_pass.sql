-- ============================================================================
-- STÄNG PÅGÅENDE PASS -- ending a shift that is running, from Alla Pass.
--
-- Deleting a pass is for one that never happened. This is for one that is
-- happening and has to stop: the site shut, the weather turned, the job
-- finished early. The hours already worked are real and must survive.
--
-- WHY THIS IS NOT "DELETE, BUT FOR ACTIVE PASSES". The Arbetsdagbok reads
-- tilldelning with released_at is null, and so does the confirmation guard's
-- missing-hours count. Releasing a row therefore ERASES the work it carries --
-- which is right for a deleted shift, because it never happened, and wrong
-- here, because it did. So the release is split by whether the person actually
-- turned up:
--
--   CLOCKED IN  -> the row stays, carrying the hours the admin logged. It
--                  confirms and it prints. They worked; the document says so.
--   NEVER CAME  -> released as 'closed_early'. Nothing to account for, and it
--                  prints nowhere, exactly as a deletion would leave it.
--
-- NO CLOCK-OUT IS MANUFACTURED. It would have been convenient to stamp one at
-- the moment of closure, and it would have been a lie in the one place the
-- system treats as evidence -- invariant 3. A worker who never stamped out did
-- not stamp out; the missing stamp is the truth, the admin's figure is the
-- claim, and the leader reconciles them at stage 1 as they would any other day.
--
-- IT DOES NOT CONFIRM THE DAY. The figures are written and the day goes to the
-- arbetsledare's Bekräfta Pass as normal. The admin cannot make a stage 1
-- confirmation -- he was not there -- and closing a pass is an administrative
-- act, not a claim about what happened on it. There is deliberately no fourth
-- route to admin_confirmed here.
-- ============================================================================

-- Released because the pass was cut short, told apart from a deletion because
-- the two are different admissions about the same empty slot.
alter type public.release_reason add value if not exists 'closed_early';

-- A shift ending early is not a shift that was deleted. The worker's next
-- action differs -- go home now, versus this was never happening -- so the
-- notice they get has to be able to say which.
alter type public.notification_kind add value if not exists 'pass_closed';

create or replace function public.close_pass(p_pass uuid, p_hours numeric)
returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_pass  public.pass;
  v_now   timestamptz := now();
  v_stage public.day_stage;
begin
  if not app.is_admin() then
    raise exception 'Endast administratören kan stänga ett pågående pass.'
      using errcode = 'insufficient_privilege';
  end if;

  select p.* into v_pass
  from public.pass p where p.id = p_pass and p.deleted_at is null;
  if v_pass.id is null then
    raise exception 'Passet finns inte, eller är redan borttaget.'
      using errcode = 'check_violation';
  end if;

  -- RUNNING, and nothing else. A pass that has not started is a plan and is
  -- deleted; one that has ended is a fact and is confirmed. Closing is only
  -- for the window between, and saying so keeps the three acts apart.
  if v_now < app.pass_start_at(v_pass.work_date, v_pass.start_time) then
    raise exception 'Passet har inte börjat än. Ta bort det i stället.'
      using errcode = 'check_violation';
  end if;
  if v_now >= app.pass_end_at(v_pass.work_date, v_pass.start_time, v_pass.end_time) then
    raise exception 'Passet är redan slut. Det bekräftas i stället.'
      using errcode = 'check_violation';
  end if;

  select pd.stage into v_stage
  from public.project_day pd
  where pd.project_id = v_pass.project_id and pd.work_date = v_pass.work_date;
  if v_stage = 'admin_confirmed' then
    raise exception 'Dagen är godkänd och låst. Den kan inte ändras.'
      using errcode = 'insufficient_privilege';
  end if;

  -- INVARIANT 1. A human typed this; nothing here derives it. Zero is a real
  -- answer -- a pass closed before anyone got started -- so only absence and
  -- nonsense are refused.
  if p_hours is null or p_hours < 0 then
    raise exception 'Ange hur många timmar passet har jobbat.'
      using errcode = 'check_violation';
  end if;

  -- They turned up. The row stays and carries the figure.
  update public.tilldelning t
  set confirmed_hours = p_hours
  where t.pass_id = p_pass
    and t.released_at is null
    and t.source <> 'ledare'
    and t.clock_in is not null;

  -- They did not. Released, and it prints nowhere.
  update public.tilldelning t
  set released_at = v_now, released_reason = 'closed_early',
      released_by = (select auth.uid())
  where t.pass_id = p_pass
    and t.released_at is null
    and t.source <> 'ledare'
    and t.clock_in is null;

  -- Everyone who held the pass is told, whichever way they went. Somebody
  -- still on site is the person who most needs to know it is over.
  insert into public.notification (account_id, kind, payload)
  select w.account_id, 'pass_closed',
         jsonb_build_object('pass_id', p_pass, 'work_date', v_pass.work_date,
                            'project_id', v_pass.project_id, 'hours', p_hours)
  from public.tilldelning t
  join public.worker w on w.id = t.worker_id
  where t.pass_id = p_pass and t.source <> 'ledare' and w.account_id is not null
    and (t.released_at is null or t.released_reason = 'closed_early');

  -- AND THE PASS ENDS NOW. This is what makes it stop being "pågående": the
  -- span on the record is what the day actually ran, so the leader's envelope,
  -- Nästa Pass and every "has it ended yet" test agree without being told
  -- separately. A night shift closed after midnight keeps end < start, which
  -- app.pass_end_at already reads as the following day.
  update public.pass
  set end_time = (v_now at time zone 'Europe/Stockholm')::time
  where id = p_pass;
end $fn$;

grant execute on function public.close_pass(uuid, numeric) to authenticated;

comment on function public.close_pass(uuid, numeric) is
  'Ends a running pass: logs the hours worked on everyone who clocked in, '
  'releases everyone who never did as closed_early, tells them all, and moves '
  'the pass end to now. Does NOT confirm the day -- stage 1 stays the '
  'arbetsledare''s, because the admin was not there.';
