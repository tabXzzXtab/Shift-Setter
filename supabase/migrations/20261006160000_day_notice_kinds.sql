-- ============================================================================
-- TWO NEW NOTIFICATION KINDS (owner, 2026-10-06)
--
--   day_approved          to the WORKERS on a day, when it reaches
--                         admin_confirmed -- by any of the four routes.
--   day_awaiting_review   to the company's ADMINS, when a leader confirms a
--                         day and it lands in Granska.
--
-- On their own, ahead of the triggers that write them: Postgres refuses a
-- new enum value inside the transaction that adds it.
-- ============================================================================

alter type public.notification_kind add value if not exists 'day_approved';
alter type public.notification_kind add value if not exists 'day_awaiting_review';
