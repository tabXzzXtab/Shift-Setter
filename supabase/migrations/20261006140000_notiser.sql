-- ============================================================================
-- NOTISER: one list of notifications per person, for every role
--
-- Until now the arbetare startsida drew every unread notification as its own
-- card with an "Okej" -- 249 of them for some workers, most saying only "Du
-- har en ny notis." -- and an arbetsledare's or an admin's notifications were
-- drawn nowhere at all. The screen is /notiser; this is what it reads and the
-- one write it makes.
--
-- 1. public.my_notification -- the caller's own rows, with the project's NAME
--    beside the id. A worker cannot read public.project (project_staff_select),
--    so the name comes through a view that runs as its owner and therefore
--    carries its own tenant and account predicate (invariant 12).
--
-- 2. app.tg_notification_only_read -- a notification is the system's word to
--    a person; the person may mark it read and nothing else. The UPDATE
--    policy is own-row only and could not say which column, so until now an
--    account could rewrite the text of its own notifications. Read also stays
--    read: there is no un-reading.
--
-- 3. public.mark_notifications_read(p_ids) -- "Markera alla som lästa", and
--    the single row a tap opens. NULL ids means all of the caller's unread.
--    SECURITY DEFINER with the account and the tenant in its own WHERE, so the
--    scope is the function's and not only the policy's.
-- ============================================================================

create or replace view public.my_notification with (security_invoker = false) as
select n.id,
       n.kind,
       n.payload,
       n.created_at,
       n.read_at,
       nullif(n.payload ->> 'work_date', '')::date as work_date,
       pr.name as project_name
from public.notification n
left join public.project pr
  on pr.id = nullif(n.payload ->> 'project_id', '')::uuid
 and pr.tenant_id = n.tenant_id
where app.in_tenant(n.tenant_id)
  and n.account_id = (select auth.uid());

grant select on public.my_notification to authenticated;

create or replace function app.tg_notification_only_read()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.account_id is distinct from old.account_id
     or new.tenant_id is distinct from old.tenant_id
     or new.kind is distinct from old.kind
     or new.payload is distinct from old.payload
     or new.created_at is distinct from old.created_at then
    raise exception 'a notification is only ever marked read; nothing else about it changes'
      using errcode = 'insufficient_privilege';
  end if;
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'a read notification stays read'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger notification_only_read
  before update on public.notification
  for each row execute function app.tg_notification_only_read();

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notification n
     set read_at = now()
   where n.account_id = (select auth.uid())
     and app.in_tenant(n.tenant_id)
     and n.read_at is null
     and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
