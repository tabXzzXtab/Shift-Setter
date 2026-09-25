-- ============================================================================
-- PUSH DISPATCH -- the three missing notifications, and the call that wakes a
-- phone.
--
-- Two halves. First the three events worth a push that wrote no notification
-- row at all, so there was nothing to send. Then one AFTER INSERT trigger on
-- notification that turns any row into a push, whatever wrote it.
--
-- ONE DISPATCH, NOT FOUR. notification is already the single place every
-- user-facing event lands, and its writers are a mix of triggers and SECURITY
-- DEFINER RPCs -- shift_deleted comes from delete_pass(), not a trigger. A
-- dispatch per event would have to be added to each of those writers and
-- remembered for every future one. Hanging it off the table catches all eight
-- kinds and anything added later for free.
--
-- THE SECRET IS NOT IN THIS FILE, AND MUST NEVER BE. The repo is public
-- (tabXzzXtab/Shift-Setter) and a function body is readable -- it would land
-- in pg_proc, in schema.snapshot.txt, and in every clone. It is read from
-- vault by name at send time. Creating it is a separate, uncommitted step:
--
--   select vault.create_secret('<value>', 'push_caller_secret',
--                              'Authorization bearer for send-push');
--
-- Until that row exists the dispatch warns and sends nothing. That is the
-- correct failure: no push, no broken write, and a line in the log saying why.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- A date a Swedish site worker reads without decoding it.
--
-- to_char would need a locale the server does not carry -- TimeZone is UTC and
-- nothing may rely on a server default (CLAUDE.md) -- so the month names are
-- spelled out. No year: a push is about this week, and "5 oktober 2026" on a
-- lock screen is noise. Day is unpadded, because "05 oktober" is not how
-- anybody says it.
-- ---------------------------------------------------------------------------
create or replace function app.svensk_datum(p_date date)
  returns text
  language sql
  immutable
  set search_path = ''
as $$
  select extract(day from p_date)::int || ' ' ||
    case extract(month from p_date)::int
      when 1 then 'januari'   when 2 then 'februari' when 3  then 'mars'
      when 4 then 'april'     when 5 then 'maj'      when 6  then 'juni'
      when 7 then 'juli'      when 8 then 'augusti'  when 9  then 'september'
      when 10 then 'oktober'  when 11 then 'november' when 12 then 'december'
    end
$$;


-- ---------------------------------------------------------------------------
-- WHOSE DAY IS IT -- the recipient set for anything about a project_day.
--
-- This mirrors app.confirms_project() deliberately, branch for branch, because
-- the person who must answer for a day is the person to tell about it
-- (invariant 4b). That function returns a boolean about the CALLER; a trigger
-- needs the accounts themselves, so the logic is restated rather than reused.
-- If confirms_project ever changes, this changes with it.
--
--   a leader stood on the day  -> that person alone, and nobody else. Not the
--                                 project's other leaders, and not whoever
--                                 held it before a swap.
--   nobody was placed          -> every leader of the project. There is no row
--                                 to point at, so membership is the only claim
--                                 available. That branch is why "notify the
--                                 leader" is sometimes several people.
--
-- TENANT BOUND WRITTEN INTO THE QUERY, NOT INHERITED. Callers are SECURITY
-- DEFINER and see past all 35 policies M2a enforces, so the isolation has to
-- be in the predicate. Joining through project and requiring the child's
-- tenant_id to match the project's is belt and braces over M1c's
-- parent-derivation -- if that ever regressed, this still refuses to notify
-- somebody in another tenancy about a day that is not theirs.
-- ---------------------------------------------------------------------------
create or replace function app.day_leader_accounts(p_project uuid, p_work_date date)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select w.account_id
  from public.tilldelning t
  join public.worker  w on w.id = t.worker_id
  join public.project p on p.id = t.project_id
  where t.project_id  = p_project
    and t.work_date   = p_work_date
    and t.source      = 'ledare'
    and t.released_at is null
    and w.deleted_at  is null
    and t.tenant_id   = p.tenant_id
    and w.tenant_id   = p.tenant_id

  union

  select pl.account_id
  from public.project_leader pl
  join public.project p on p.id = pl.project_id
  where pl.project_id = p_project
    and pl.tenant_id  = p.tenant_id
    and not exists (
      select 1 from public.tilldelning t2
      where t2.project_id  = p_project
        and t2.work_date   = p_work_date
        and t2.source      = 'ledare'
        and t2.released_at is null
    )
$$;


-- ===========================================================================
-- THE THREE EVENTS THAT WROTE NOTHING
--
-- shift_offered and day_unconfirmed have existed in notification_kind since
-- the initial schema and were raised by nothing -- a later migration called
-- day_unconfirmed "the unused" one in passing. day_admin_confirmed was added
-- by the migration before this one. All three are wired up here.
--
-- EVERY INSERT OMITS tenant_id, AND THAT IS THE POINT. M1c derives it from
-- the parent row -- for notification, from account_id, the person being told.
-- Passing app.current_tenant_id() would be wrong and would be refused: since
-- M2a that function can return a super admin's ACTING tenant, so an operator
-- working inside a client tenancy would stamp their own. The suite asserts
-- this as TENANT.notification_follows_the_recipient.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A worker has been put on a shift.
--
-- NAMED SOURCES, NOT "everything except ledare". Two sources are excluded and
-- for different reasons.
--
-- 'ledare' is auto-assignment: a leader is placed on their own project's day
-- by the system, and "du har fått ett pass" on every generation is noise.
--
-- 'oppen' is the worker booking THEMSELVES off Öppna Pass. They tapped Boka
-- Pass a moment ago and watched the screen confirm it; a phone buzzing to
-- announce the thing they just did reads as a system that is not paying
-- attention. Listing the four sources that are somebody ELSE placing a worker
-- is what makes that distinction survive a new source being added later --
-- a bare <> 'ledare' would silently start notifying for it.
-- ---------------------------------------------------------------------------
create or replace function app.tg_notify_shift_offered()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.notification (account_id, kind, payload)
  select w.account_id, 'shift_offered',
         jsonb_build_object('project_id', new.project_id,
                            'work_date',  new.work_date,
                            'pass_id',    new.pass_id)
  from public.worker  w
  join public.project p on p.id = new.project_id
  where w.id          = new.worker_id
    and w.deleted_at  is null
    and w.tenant_id   = p.tenant_id;
  return null;
end $$;

drop trigger if exists notify_shift_offered on public.tilldelning;
create trigger notify_shift_offered
  after insert on public.tilldelning
  for each row
  when (new.source in ('handplockad', 'forval', 'manuell', 'snabb'))
  execute function app.tg_notify_shift_offered();


-- ---------------------------------------------------------------------------
-- Stage 2 sent a day back.
--
-- Rejection is the only thing that reopens a confirmed day (invariant 5), so
-- this is the one notification a leader cannot afford to miss: the day is in
-- their queue again and nothing else will tell them.
-- ---------------------------------------------------------------------------
create or replace function app.tg_notify_day_rejected()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.notification (account_id, kind, payload)
  select a, 'day_unconfirmed',
         jsonb_build_object('project_id', new.project_id,
                            'work_date',  new.work_date)
  from app.day_leader_accounts(new.project_id, new.work_date) a;
  return null;
end $$;

drop trigger if exists notify_day_rejected on public.day_review;
create trigger notify_day_rejected
  after insert on public.day_review
  for each row
  when (new.action = 'rejected')
  execute function app.tg_notify_day_rejected();


-- ---------------------------------------------------------------------------
-- The admin approved a day at stage 2.
--
-- confirmed_via = 'leader' IS THE WHOLE FILTER. Four routes reach
-- admin_confirmed and only this one has a leader behind it. The bristsurvey,
-- a flagged day and a Snabb Pass filed direkt also land on admin_confirmed,
-- and on none of them did a leader make a claim that could be approved --
-- telling them "din dag är bekräftad" would be reporting back an approval of
-- something they never said.
--
-- old.stage IS DISTINCT FROM new.stage, or every later touch of the row
-- notifies again. A day that is edited after approval must not re-announce
-- itself.
--
-- NO HOURS ANYWHERE, by invariant 10: a worker learns their hours only once
-- an Arbetsdagbok covering the date exists. This goes to the leader only, and
-- the payload carries no figure for the dispatch to find even if it wanted
-- one.
-- ---------------------------------------------------------------------------
create or replace function app.tg_notify_day_admin_confirmed()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.notification (account_id, kind, payload)
  select a, 'day_admin_confirmed',
         jsonb_build_object('project_id', new.project_id,
                            'work_date',  new.work_date)
  from app.day_leader_accounts(new.project_id, new.work_date) a;
  return null;
end $$;

drop trigger if exists notify_day_admin_confirmed on public.project_day;
create trigger notify_day_admin_confirmed
  after update on public.project_day
  for each row
  when (new.stage = 'admin_confirmed'
        and old.stage is distinct from new.stage
        and new.confirmed_via = 'leader')
  execute function app.tg_notify_day_admin_confirmed();


-- ===========================================================================
-- THE DISPATCH
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Turn a notification row into a push.
--
-- THE BODY IS BUILT FROM A FIXED TEMPLATE PER KIND, NEVER FROM THE PAYLOAD'S
-- OWN KEYS. That is a safety property, not a style preference: pass_closed
-- carries 'hours' in its payload, and anything that rendered a payload
-- generically would put a figure on a worker's lock screen and break invariant
-- 10. Only project_id and work_date are ever read, and each kind's sentence is
-- written out here.
--
-- FAILURE MUST NOT REACH THE CALLER. This runs inside the transaction that
-- deleted a pass or rejected a day. Without the exception block a missing
-- vault row, a dropped extension or a malformed URL would raise, and the
-- business write -- the actual thing the person was doing -- would roll back
-- because a notification could not be queued. A push that does not arrive is a
-- phone that stays quiet; a push that raises is a shift that cannot be
-- deleted. The block catches everything and warns.
--
-- NOBODY TO WAKE, NO REQUEST. Most accounts have no device: every browser-only
-- user and everyone who declined the OS prompt. The exists() check costs an
-- index lookup on push_token_account and saves an HTTPS round trip that would
-- have returned {"sent":0} on most rows this fires for.
--
-- net.http_post QUEUES AND RETURNS. Delivery happens in a background worker
-- outside this transaction, which is what keeps an HTTPS call to Google off
-- the critical path of a shift deletion.
-- ---------------------------------------------------------------------------
create or replace function app.tg_notification_push()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
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
end $$;

drop trigger if exists notification_push on public.notification;
create trigger notification_push
  after insert on public.notification
  for each row
  execute function app.tg_notification_push();


-- ---------------------------------------------------------------------------
-- Nothing here is callable from a browser. These are trigger functions and
-- one helper; PostgREST serves only its exposed schemas and app is not one
-- (CLAUDE.md, gotcha 2), but EXECUTE defaults to PUBLIC and day_leader_accounts
-- would otherwise answer "who leads this day" to anyone who found a path to it.
-- ---------------------------------------------------------------------------
revoke all on function app.svensk_datum(date) from public;
revoke all on function app.day_leader_accounts(uuid, date) from public;
revoke all on function app.tg_notify_shift_offered() from public;
revoke all on function app.tg_notify_day_rejected() from public;
revoke all on function app.tg_notify_day_admin_confirmed() from public;
revoke all on function app.tg_notification_push() from public;
