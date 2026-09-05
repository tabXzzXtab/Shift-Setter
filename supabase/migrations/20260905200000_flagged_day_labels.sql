-- ============================================================================
-- STEP 5c, part one -- the labels a flagged day needs.
--
-- Split from the migration that uses them, and not for tidiness: a new enum
-- value cannot be USED in the transaction that adds it, and the guard below
-- compares against these by name.
--
-- 'worker_ansvarig' -- the day ran with a worker covering as ansvarig. They
--                      were covering, not supervising.
-- 'ingen_ledare'    -- the day ran with nobody answerable for it at all.
--
-- BOTH ARE FLAGS AND BOTH ARE ADMIN-ONLY, and they are still two values rather
-- than one, because they are different admissions about how the day ran and
-- collapsing them loses the part that matters.
--
-- 'day_flagged'     -- what the admin is told, and it is its own kind: a day
--                      nobody was answerable for is not the same message as a
--                      shift being deleted.
-- 'leader_replaced' -- what the two arbetsledare are told when one takes the
--                      other's day. Neither of them chose it, so neither
--                      should have to find out by looking.
-- ============================================================================

alter type public.confirmation_source add value if not exists 'worker_ansvarig';
alter type public.confirmation_source add value if not exists 'ingen_ledare';
alter type public.notification_kind   add value if not exists 'day_flagged';
alter type public.notification_kind   add value if not exists 'leader_replaced';
