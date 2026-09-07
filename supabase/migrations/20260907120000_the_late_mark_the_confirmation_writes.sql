-- ============================================================================
-- A LEADER COULD NOT CONFIRM A DAY ANYBODY WAS LATE ON.
--
-- Stage 1 bumps worker.late_marks for every row the leader marked late, from
-- inside app.tg_confirmation_guard(). That UPDATE fires the worker table's own
-- guard, which refuses anyone who is not an admin -- so the confirmation died
-- with "only an admin may change name, email, late marks or deletion state"
-- and the day could not be closed by the one person the spec says must close
-- it. Only an admin could get past it, which moves stage 1 to the wrong desk
-- entirely: reviewing a claim is not making one, and the admin was being
-- handed the making of it by a trigger nobody looked at.
--
-- Reproduced before fixing, and it is WIDER than it was reported. The report
-- was that a leader is blocked on a day they themselves are marked late. The
-- guard has nothing to do with whose row it is: the confirmation runs SECURITY
-- DEFINER, so its UPDATE reaches every late worker on the day, and the very
-- first of those rows raises. A leader was blocked from confirming a day ANY
-- of their people was late on -- and "one row, one late mark" is the whole
-- mechanism the priority list demotes people with, so it was not a rare path.
--
-- WHAT IS NOT TOUCHED. app.tg_confirmation_guard() and the confirmation flow
-- are unchanged; the fix is entirely inside the guard that was refusing them.
-- Nothing about who may confirm which day moves -- that is
-- app.confirms_project(), upstream, and it stays exactly where it is.
-- ============================================================================

create or replace function app.tg_worker_self_edit_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  if app.is_admin() then
    return new;
  end if;

  -- THE LATE MARK THE CONFIRMATION ITSELF WRITES.
  --
  -- Not a person editing their own record, which is what this guard exists to
  -- stop. Narrow on purpose, and it takes nobody's word for what it is:
  --
  --   pg_trigger_depth() > 1  the row is being written BY another trigger and
  --                           not by a client UPDATE. Somebody editing their
  --                           own worker row is always at depth 1, so this is
  --                           the one thing a caller cannot dress up as.
  --   exactly +1              the increment the confirmation makes. Every write
  --                           to this table from a trigger is that same bump;
  --                           a write setting late_marks to anything else is
  --                           not this one and is refused below.
  --   late_marks ALONE        name, email, account_id and deleted_at stay the
  --                           admin's, on this path as on every other. A
  --                           confirmation has no business moving them, so a
  --                           write that moves one is not a confirmation.
  --   staff                   an arbetare never reaches a confirmation at all.
  --                           WHICH leader may confirm WHICH day is decided by
  --                           app.confirms_project() before this runs, and is
  --                           deliberately not restated here: two answers to
  --                           that question would eventually disagree.
  if pg_trigger_depth() > 1
     and app.is_staff()
     and new.late_marks = old.late_marks + 1
     and new.name       is not distinct from old.name
     and new.email      is not distinct from old.email
     and new.account_id is not distinct from old.account_id
     and new.deleted_at is not distinct from old.deleted_at then
    return new;
  end if;

  if new.name is distinct from old.name
     or new.email is distinct from old.email
     or new.late_marks is distinct from old.late_marks
     or new.account_id is distinct from old.account_id
     or new.deleted_at is distinct from old.deleted_at then
    raise exception 'only an admin may change name, email, late marks or deletion state'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $fn$;
