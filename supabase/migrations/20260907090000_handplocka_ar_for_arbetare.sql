-- ============================================================================
-- HANDPLOCKA IS FOR ARBETARE.
--
-- Hand-picking fills the slots a pass DEMANDED. An arbetsledare never occupies
-- one: Step 4b places them on the day the moment a worker holds a slot on
-- their project, and that row was never a slot the pass asked for. So a leader
-- in the Handplocka list is offering the wrong thing under the right name.
--
-- It is not merely untidy. Step 4b skips "a leader who already holds an
-- ORDINARY assignment that date" -- they cannot be in two places -- so
-- hand-picking a leader onto a worker slot is precisely how a day loses the
-- person answerable for it. The list that reads as "put them on the job" is
-- the one that takes them off it, and a leader hand-picking themselves does
-- it to their own day.
--
-- The rule is about WHO IS NAMED, not who is asking, so it is the same for the
-- admin: an arbetsledare is placed, never picked. An admin's own worker row --
-- they have one whenever the account was promoted rather than bootstrapped --
-- is out for the same reason.
--
-- Nothing here touches förval or Tier 3. A leader who marks a day can still be
-- ranked onto a slot, and that gap stays where Step 5c already records it.
-- ============================================================================

-- The roster carries the role now, so the Handplocka list can ask for arbetare
-- rather than filtering names it was never told anything about. Appended, so
-- the six callers that select id and name are unaffected.
create or replace view public.worker_roster with (security_invoker = false) as
select w.id, w.name, w.late_marks, a.role
from public.worker w
join public.account a on a.id = w.account_id
where w.deleted_at is null       -- INVARIANT 8
  and app.is_staff();

-- The boundary. The list above is decorative on its own.
create or replace function app.tg_handpick_is_an_arbetare() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  select a.role into v_role
  from public.worker w
  join public.account a on a.id = w.account_id
  where w.id = new.worker_id;

  -- NULL is a denial (gotcha 3): a worker with no account behind them is not
  -- an arbetare, and `<> 'arbetare'` would let them through.
  if v_role is distinct from 'arbetare' then
    raise exception 'only an arbetare can be hand-picked; an arbetsledare is placed on the day automatically'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger handpick_is_an_arbetare
  before insert or update on public.pass_batch_handpick
  for each row execute function app.tg_handpick_is_an_arbetare();

comment on table public.pass_batch_handpick is
  'Hand-picking does not assign. It is a ranking modifier on forval: the '
  'forval is the entry ticket, and a hand-picked worker who did not mark the '
  'day is simply not on the list. That is not a mistake and needs no warning. '
  'Only an arbetare may be named here -- an arbetsledare is placed on the day '
  'by Step 4b, and hand-picking one onto a worker slot is what takes them off '
  'the day they were meant to lead.';
