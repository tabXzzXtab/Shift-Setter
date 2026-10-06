-- ============================================================================
-- THE KIND IS CAST (fix to 20261006160100)
--
-- tg_notify_day_approved wrote 'day_approved' under SELECT DISTINCT, and
-- DISTINCT resolves an untyped literal to text before the insert sees the
-- column -- "column kind is of type notification_kind but expression is of
-- type text". It raised inside approve_day and took the approval down with
-- it: "Dagen kunde inte godkännas" on Granska. Both new triggers now name
-- the type. Found on the live site by the frontend sweep, 2026-10-06.
-- ============================================================================

create or replace function app.tg_notify_day_approved()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.stage is not distinct from new.stage then
    return null;
  end if;
  insert into public.notification (account_id, kind, payload)
  select distinct w.account_id, 'day_approved'::public.notification_kind,
         jsonb_build_object('project_id', new.project_id,
                            'work_date',  new.work_date)
  from public.tilldelning t
  join public.worker  w on w.id = t.worker_id and w.deleted_at is null
  where t.project_id  = new.project_id
    and t.work_date   = new.work_date
    and t.released_at is null
    and t.source     <> 'ledare'
    and w.tenant_id   = new.tenant_id;
  return null;
end $$;

create or replace function app.tg_notify_day_awaiting_review()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.stage is not distinct from new.stage then
    return null;
  end if;
  insert into public.notification (account_id, kind, payload)
  select a.id, 'day_awaiting_review'::public.notification_kind,
         jsonb_build_object('project_id', new.project_id,
                            'work_date',  new.work_date)
  from public.account a
  where a.tenant_id  = new.tenant_id
    and a.role       = 'admin'
    and a.active
    and a.deleted_at is null;
  return null;
end $$;
