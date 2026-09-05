-- ============================================================================
-- ÖPPNA PASS -- every slot still going spare.
--
-- Acceptera Pass shows a worker the offers open TO THEM: my_offer filters to
-- state = 'offered', so a shift they said no to disappears the moment they say
-- it. That is right for a card you swipe through, and wrong as the last word:
-- someone whose plans changed on Tuesday has no way back to the Wednesday they
-- turned down, because declining an offer does not block the pass -- it only
-- answers the question.
--
-- So this is the list behind the cards. Same shifts, no filter on whether they
-- were declined, and nothing to press: the worker asks their leader. It exists
-- because a slot nobody can see is a slot nobody fills.
--
-- An arbetare cannot read public.pass at all -- the policy is scoped to
-- app.leads_project -- so this reaches them through a view or not at all. It
-- runs as its owner and carries only what Acceptera Pass already shows them:
-- where the work is, when, and how many places are left. No names, no hours
-- anyone has worked, nothing about who else was asked.
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
join public.project pr on pr.id = p.project_id and pr.deleted_at is null  -- INVARIANT 8
left join public.tilldelning t on t.pass_id = p.id and t.released_at is null
where p.deleted_at is null
  -- Only what can still be taken. A shift that has started is not an opening.
  and app.pass_start_at(p.work_date, p.start_time) > now()
  -- INVARIANT 2: a day this worker already holds is not open to them, whatever
  -- the slot count says, and the assignment guard would refuse it anyway.
  -- current_worker_id() is null for an account with no worker record, so an
  -- admin looking at this sees every opening rather than none.
  and not exists (
    select 1 from public.tilldelning mine
    where mine.worker_id = app.current_worker_id()
      and mine.work_date = p.work_date
      and mine.released_at is null
  )
group by p.id, p.work_date, p.start_time, p.end_time,
         p.planned_hours, p.headcount, pr.name, pr.site_address
having p.headcount - count(t.id) > 0;

grant select on public.open_pass to authenticated;
revoke all on public.open_pass from anon;
