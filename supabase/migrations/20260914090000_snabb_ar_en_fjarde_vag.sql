-- ============================================================================
-- A FOURTH ROUTE TO admin_confirmed, AND THE WORD FOR IT
--
-- Three routes reached admin_confirmed: stage 2 approval, the bristsurvey, and
-- a flagged day. This adds the one the admin walks when they arrange a day
-- themselves -- rang somebody at eight, put them on site, and is stating the
-- hours they agreed. `confirmed_via` records WHICH ROUTE CLOSED A DAY, and a
-- day closed this way is a different claim from all three: not a leader's
-- account from site, not an owner reconstructing a gap from phone calls, and
-- not a day nobody was answerable for.
--
-- `flagged_as` is deliberately NOT extended. That column records how a day
-- RAN -- with a worker covering, or with nobody -- and a Snabb Pass day has
-- whoever leads the project standing on it like any other day. Saying
-- otherwise would be the wrong admission, and it would route the day into the
-- admin's review queue while taking it out of the leader's, which is backwards
-- from both modes' intent.
--
-- THIS FILE IS ALONE FOR A REASON. `alter type ... add value` cannot be USED
-- in the transaction that adds it, so the migration that writes 'snabb' by
-- name has to be a separate file applied after this one commits. It also means
-- `npm run db:validate` -- which runs a migration inside a transaction and
-- rolls it back -- cannot validate the second file until this one is live.
-- The same reason 20260905200000_flagged_day_labels.sql stands apart from
-- 20260905200100_flagged_days.sql.
-- ============================================================================

alter type public.confirmation_source add value if not exists 'snabb';

-- Efter bekräftelse: the day waits for the arbetsledare exactly as it does
-- today, but a day the leader did not plan should not depend on them noticing
-- it. Its own kind rather than the unused 'day_unconfirmed', because what the
-- leader needs to know is not "a day is open" -- days are open all the time --
-- but "somebody was added to your day without you".
alter type public.notification_kind add value if not exists 'snabb_review';
