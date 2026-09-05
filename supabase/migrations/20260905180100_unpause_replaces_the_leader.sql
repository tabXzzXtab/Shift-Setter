-- ============================================================================
-- Unpausing an arbetsledare puts them back on their days.
--
-- Pausing an account releases every shift that has not started, the leader's
-- auto-assigned rows included, and that is right: a paused person is not
-- working. The row keeps the reason it actually had -- 'account_paused' --
-- because the workers did not leave, the person was paused, and those are
-- different facts about the same empty day.
--
-- WHAT WAS MISSING WAS NOT THE LABEL. app.sync_leader_day() only ever treats
-- 'removed_by_leader' as a tombstone, so a row released by a pause has never
-- blocked re-placement. What blocked it was that nothing ran: the only trigger
-- on public.account fires on active going true -> false, so reactivating
-- somebody changed a flag and touched nothing else. The leader came back the
-- next time a worker's assignment happened to move, which is not a rule
-- anyone could rely on.
--
-- So the other direction gets a trigger too, and it asks the same question
-- Step 4b asks everywhere: for each day this account's projects still have
-- workers on, who should be on it?
--
-- FUTURE AND UNCONFIRMED ONLY, matching the pause it undoes. The pause let go
-- of shifts that had not started; this takes back the same ones. A day that
-- already ran without them ran without them, and a confirmed day is closed --
-- adding a row to one would be a claim about hours nobody confirmed.
-- ============================================================================

create or replace function app.tg_account_unpause() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  r record;
begin
  for r in
    select distinct t.project_id, t.work_date
    from public.project_leader pl
    join public.tilldelning t on t.project_id = pl.project_id
    join public.pass p        on p.id = t.pass_id and p.deleted_at is null
    left join public.project_day pd
           on pd.project_id = t.project_id and pd.work_date = t.work_date
    where pl.account_id = new.id
      and t.released_at is null
      -- Days that still have PEOPLE on them. A leader's own row is not a
      -- reason to place a leader.
      and t.source <> 'ledare'
      and app.pass_start_at(p.work_date, p.start_time) > now()
      and pd.confirmed_at is null
  loop
    perform app.sync_leader_day(r.project_id, r.work_date);
  end loop;

  return null;
end $fn$;

drop trigger if exists account_unpause on public.account;
create trigger account_unpause
  after update of active on public.account
  for each row
  when (not old.active and new.active)
  execute function app.tg_account_unpause();
