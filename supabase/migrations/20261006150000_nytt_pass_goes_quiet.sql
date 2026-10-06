-- ============================================================================
-- "NYTT PASS" GOES QUIET BY ITSELF (owner, 2026-10-06, Q4)
--
-- shift_offered ("Nytt pass -- Du har fått ett pass ...") is written when a
-- worker is PLACED on a shift (tg_notify_shift_offered, AFTER INSERT on
-- tilldelning). Nobody answers it, so left alone it piles up: 249 unread for
-- some workers. It now stops counting as unread when it stops being news:
--
-- 1. THE SHIFT IS CANCELLED -- the worker's place on it is released, for any
--    reason (Avboka, the pass deleted, a pause, a close). A trigger marks the
--    notification read at that moment; the worker has a "Pass inställt" or
--    similar for the cancellation itself where one applies.
--
-- 2. ITS DAY HAS PASSED -- there is no cron to write that (no server), so
--    my_notification READS a past day's shift_offered as read, from the end
--    of that day in Stockholm. Computed on every read, so it is true on every
--    device at once, and it clears the existing pile without touching a row.
--    The bell counts through the same view.
-- ============================================================================

create or replace function app.tg_quiet_offer_on_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification n
     set read_at = now()
    from public.worker w
   where w.id = new.worker_id
     and n.account_id = w.account_id
     and n.tenant_id = new.tenant_id
     and n.kind = 'shift_offered'
     and n.payload ->> 'pass_id' = new.pass_id::text
     and n.read_at is null;
  return null;
end $$;

create trigger quiet_offer_on_release
  after update of released_at on public.tilldelning
  for each row
  when (old.released_at is null and new.released_at is not null)
  execute function app.tg_quiet_offer_on_release();

-- What is already released gets the same treatment once.
update public.notification n
   set read_at = now()
  from public.tilldelning t
  join public.worker w on w.id = t.worker_id
 where n.kind = 'shift_offered'
   and n.read_at is null
   and n.account_id = w.account_id
   and n.payload ->> 'pass_id' = t.pass_id::text
   and t.released_at is not null
   and not exists (select 1 from public.tilldelning t2
                   where t2.pass_id = t.pass_id and t2.worker_id = t.worker_id
                     and t2.released_at is null);

create or replace view public.my_notification with (security_invoker = false) as
select n.id,
       n.kind,
       n.payload,
       n.created_at,
       coalesce(
         n.read_at,
         case when n.kind = 'shift_offered'
               and nullif(n.payload ->> 'work_date', '')::date < app.stockholm_today()
              then (nullif(n.payload ->> 'work_date', '')::date + 1)::timestamp
                   at time zone 'Europe/Stockholm'
         end) as read_at,
       nullif(n.payload ->> 'work_date', '')::date as work_date,
       pr.name as project_name
from public.notification n
left join public.project pr
  on pr.id = nullif(n.payload ->> 'project_id', '')::uuid
 and pr.tenant_id = n.tenant_id
where app.in_tenant(n.tenant_id)
  and n.account_id = (select auth.uid());
