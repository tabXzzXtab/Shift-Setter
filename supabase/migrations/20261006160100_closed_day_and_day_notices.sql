-- ============================================================================
-- A CONFIRMED DAY TAKES NO NEW PASSES, AND TWO NOTICES (owner, 2026-10-06)
--
-- 1. pass_on_closed_day. A leader could create a pass on a day already
--    confirmed -- the sweep did it on an admin_confirmed day -- and nothing
--    refused it until a worker pressed Acceptera, when the assignment guard
--    answered in raw English. The pass itself is now refused, at either
--    stage: a leader_confirmed day is final for the leader (invariant 5), and
--    a pass added after their claim would sit outside it. Rejection clears
--    confirmed_at, which is what reopens a day here as everywhere else.
--    Checked on insert, and on an update that MOVES a pass (project or date)
--    -- soft-deleting one is an update too, and must still be possible.
--
-- 2. day_approved -- the workers on a day hear that it is approved, on every
--    route to admin_confirmed (stage 2, bristsurvey, a flagged day, a Snabb
--    Pass filed direkt). It says the day is approved and nothing else: no
--    hours, by invariant 10 -- a worker learns the figure only once an
--    Arbetsdagbok covers the date. The leader keeps day_admin_confirmed.
--    INSERT as well as UPDATE: the bristsurvey and a Snabb Pass filed direkt
--    can create the row already at admin_confirmed.
--
-- 3. day_awaiting_review -- the company's active admins hear that a leader
--    confirmed a day and it is in Granska. Again after a re-confirmation,
--    because a sent-back day coming back is news too. The admins of THE DAY's
--    tenancy only: an operator is not told about a client's days.
--
-- Every insert omits tenant_id: M1c derives it from the recipient.
-- ============================================================================

create or replace function app.tg_pass_on_closed_day()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if exists (
    select 1 from public.project_day pd
    where pd.project_id = new.project_id
      and pd.work_date  = new.work_date
      and pd.confirmed_at is not null
  ) then
    raise exception 'day % is confirmed; it takes no new passes', new.work_date
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists pass_on_closed_day on public.pass;
create trigger pass_on_closed_day
  before insert or update of project_id, work_date on public.pass
  for each row
  when (new.deleted_at is null)
  execute function app.tg_pass_on_closed_day();


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
  select distinct w.account_id, 'day_approved',
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

drop trigger if exists notify_day_approved on public.project_day;
create trigger notify_day_approved
  after insert or update on public.project_day
  for each row
  when (new.stage = 'admin_confirmed')
  execute function app.tg_notify_day_approved();


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
  select a.id, 'day_awaiting_review',
         jsonb_build_object('project_id', new.project_id,
                            'work_date',  new.work_date)
  from public.account a
  where a.tenant_id  = new.tenant_id
    and a.role       = 'admin'
    and a.active
    and a.deleted_at is null;
  return null;
end $$;

drop trigger if exists notify_day_awaiting_review on public.project_day;
create trigger notify_day_awaiting_review
  after insert or update on public.project_day
  for each row
  when (new.stage = 'leader_confirmed')
  execute function app.tg_notify_day_awaiting_review();


-- The push text for the two new kinds. The rest of the function is the live
-- definition unchanged: a fixed sentence per kind, never the payload's keys.
create or replace function app.tg_notification_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_secret  text;
  v_project text;
  v_date    text;
  v_title   text;
  v_body    text;
begin
  -- Nobody to wake.
  if not exists (select 1 from public.push_token pt where pt.account_id = new.account_id) then
    return null;
  end if;

  select vault.decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'push_caller_secret';

  if v_secret is null then
    raise warning 'push: vault secret push_caller_secret is missing; notification % not sent', new.id;
    return null;
  end if;

  -- The project name, scoped to the recipient's own tenancy. A notification
  -- naming a project from another tenant would be a leak in one word.
  select p.name into v_project
  from public.project p
  join public.account a on a.id = new.account_id
  where p.id = (new.payload ->> 'project_id')::uuid
    and p.tenant_id = a.tenant_id;

  v_date := app.svensk_datum((new.payload ->> 'work_date')::date);

  if v_project is null or v_date is null then
    raise warning 'push: notification % has no project or date to name', new.id;
    return null;
  end if;

  case new.kind
    when 'shift_offered' then
      v_title := 'Nytt pass';
      v_body  := 'Du har fått ett pass ' || v_date || ' på ' || v_project;
    when 'shift_deleted' then
      v_title := 'Pass inställt';
      v_body  := 'Ditt pass ' || v_date || ' på ' || v_project || ' är borttaget';
    when 'day_unconfirmed' then
      v_title := 'Pass skickat tillbaka';
      v_body  := 'Dagen ' || v_date || ' på ' || v_project || ' behöver din bekräftelse igen';
    when 'day_admin_confirmed' then
      v_title := 'Dag bekräftad';
      v_body  := 'Dagen ' || v_date || ' på ' || v_project || ' är bekräftad av admin';
    when 'snabb_review' then
      v_title := 'Snabb Pass att granska';
      v_body  := v_date || ' på ' || v_project || ' behöver din genomgång';
    when 'leader_replaced' then
      v_title := 'Du har bytts ut';
      v_body  := 'Du är inte längre arbetsledare för ' || v_date || ' på ' || v_project;
    when 'pass_closed' then
      v_title := 'Pass stängt';
      v_body  := 'Passet ' || v_date || ' på ' || v_project || ' har stängts';
    when 'day_flagged' then
      v_title := 'Dag flaggad';
      v_body  := 'Dagen ' || v_date || ' på ' || v_project || ' kräver din uppmärksamhet';
    when 'day_approved' then
      v_title := 'Dag godkänd';
      v_body  := 'Din dag ' || v_date || ' på ' || v_project || ' är godkänd';
    when 'day_awaiting_review' then
      v_title := 'Dag att granska';
      v_body  := 'Dagen ' || v_date || ' på ' || v_project || ' är bekräftad och väntar på dig';
    else
      -- A kind added later without a sentence here stays silent rather than
      -- sending an empty banner. The warning is how it gets noticed.
      raise warning 'push: no Swedish text for notification kind %', new.kind;
      return null;
  end case;

  perform net.http_post(
    url     => 'https://ahujmzahjuvnlzbyyycc.supabase.co/functions/v1/send-push',
    body    => jsonb_build_object(
                 'account_id', new.account_id,
                 'title',      v_title,
                 'body',       v_body,
                 'data',       jsonb_build_object(
                                 'kind',       new.kind::text,
                                 'project_id', new.payload ->> 'project_id',
                                 'work_date',  new.payload ->> 'work_date')),
    params  => '{}'::jsonb,
    headers => jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds => 5000);

  return null;
exception when others then
  raise warning 'push: dispatch failed for notification % (%): %', new.id, new.kind, sqlerrm;
  return null;
end $function$;
