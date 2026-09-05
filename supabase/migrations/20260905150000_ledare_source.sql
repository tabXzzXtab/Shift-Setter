-- ============================================================================
-- STEP 4b, part one -- the two enum labels the auto-assignment needs.
--
-- Split from the migration that uses them, and not for tidiness: a new enum
-- value cannot be USED in the transaction that adds it. An index predicate
-- reading `source <> 'ledare'` is evaluated when the index is built, so it has
-- to see a value that is already committed. Two files, two transactions.
--
-- 'ledare'          -- the auto-assignment of Step 4b. Not a slot the pass was
--                      demanding: the leader's row exists because workers are
--                      there, so it never consumes headcount and never
--                      competes with anyone on the priority list.
--
-- 'no_workers_left' -- the leader's row is released when the last worker comes
--                      off the day. It is not a removal by anyone, and saying
--                      'removed_by_leader' would put a person's name on
--                      something nobody did.
-- ============================================================================

alter type public.assignment_source add value if not exists 'ledare';
alter type public.release_reason    add value if not exists 'no_workers_left';
