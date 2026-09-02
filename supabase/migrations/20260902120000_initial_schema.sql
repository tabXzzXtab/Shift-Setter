-- ============================================================================
-- Shift Setter -- initial schema
--
-- One migration, complete. Covers every entity in spec Section 3 and every
-- rule in Sections 4 and 5.
--
-- Enforcement lives here, not in the client. The app is a static export: the
-- browser holds the token and talks to PostgREST directly, so anything the
-- interface refuses is decorative. Column-level grants cannot separate the
-- roles either -- every logged-in user is the same database role, so a grant
-- that restricts arbetare restricts arbetsledare identically. Triggers
-- comparing OLD and NEW are the mechanism that works. (Spec Section 6.)
--
-- Invariant references in comments are to spec Section 5.
-- ============================================================================

create extension if not exists btree_gist;

-- Internal helpers live off the exposed schema so PostgREST cannot call them
-- as RPC. Nothing here is granted to anon or authenticated.
create schema if not exists app;

-- ============================================================================
-- ENUMS
-- ============================================================================

create type public.app_role as enum ('admin', 'arbetsledare', 'arbetare');

-- How a worker reached a pass. Spec Section 3, Tilldelning.
create type public.assignment_source as enum (
  'handplockad',  -- Tier 1: hand-picked by the leader AND pre-picked the day
  'forval',       -- Tier 2: pre-picked the day
  'oppen',        -- Tier 3: accepted from Acceptera Pass
  'manuell',      -- placed by hand, e.g. inside five days of the shift
  'snabb'         -- Snabb Pass, bypassing the priority list entirely
);

-- Why an assignment stopped counting. The row is never deleted: a released
-- assignment is evidence of what was planned, and Step 5b's cascade needs to
-- know who was taken off so they are never re-offered the same pass.
create type public.release_reason as enum (
  'removed_by_leader',      -- Step 5b, trash icon on the day
  'replaced_by_snabb',      -- Step 7, the Snabb Pass wins and this is released
  'shift_deleted',          -- admin deleted the pass
  'absent_at_confirmation'  -- Step 8, "removing someone who wasn't there"
);

create type public.offer_state as enum ('offered', 'accepted', 'declined', 'withdrawn');

-- In-app only. No push, no email, no digests -- those need a server or a
-- scheduled function and neither exists. (Spec Section 6.)
create type public.notification_kind as enum ('shift_deleted', 'shift_offered', 'day_unconfirmed');

-- Provenance on a confirmed day. A leader confirming from site and an owner
-- reconstructing from phone calls are different claims about the same hours,
-- and the record must be able to tell them apart. (Spec Section 1,
-- "Bristsurvey".)
create type public.confirmation_source as enum ('leader', 'bristsurvey');

-- ============================================================================
-- TIME HELPERS -- invariant 9, Stockholm-anchored
--
-- The database server's TimeZone is UTC. Nothing may rely on a server default:
-- a shift must never file under the wrong month because UTC midnight has not
-- arrived yet. Every "today" and every day boundary goes through these.
-- ============================================================================

create or replace function app.stockholm_today() returns date
  language sql stable
  set search_path = ''
as $$ select (now() at time zone 'Europe/Stockholm')::date $$;

create or replace function app.pass_start_at(p_date date, p_start time) returns timestamptz
  language sql stable
  set search_path = ''
as $$ select (p_date + p_start) at time zone 'Europe/Stockholm' $$;

-- A shift whose end time is at or before its start time crosses midnight.
-- Night shifts are real here -- see Section 9, the soft clocking window.
create or replace function app.pass_end_at(p_date date, p_start time, p_end time) returns timestamptz
  language sql stable
  set search_path = ''
as $$
  select ((case when p_end <= p_start then p_date + 1 else p_date end) + p_end)
         at time zone 'Europe/Stockholm'
$$;

-- ============================================================================
-- IDENTITY: account and worker
--
-- Spec Section 3: every worker has an account; not every account has a worker.
-- Modelled with ONE foreign key -- worker.account_id, NOT NULL and UNIQUE.
-- That single column expresses both halves: a worker cannot exist without an
-- account, and an account with no worker is simply one no worker row points
-- at. A second FK on account.worker_id would be redundant, would need
-- deferred constraints to break the insert cycle, and could disagree with
-- this one. account.worker_id is available as a view column instead.
-- ============================================================================

create table public.account (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.app_role not null default 'arbetare',
  -- "Paused" in invariant 11. A paused account keeps its row and its history.
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.account (id)
);

comment on table public.account is
  'A login. Role is read from here, never from the JWT, so a role change takes '
  'effect on next load instead of persisting stale for the token lifetime.';

create table public.worker (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null unique references public.account (id) on delete restrict,

  -- Required at creation.
  name              text not null check (btrim(name) <> ''),
  email             text not null check (btrim(email) <> ''),

  -- Filled by the worker later, in their own profile. Never required.
  phone             text,
  personnummer      text,
  bank_number       text,
  clearing_number   text,
  avatar_url        text,

  -- Cumulative and permanent (Step 4, Tier 2). Incremented when a day is
  -- confirmed with a late mark; never decremented, so removing the assignment
  -- afterwards cannot launder the demotion away.
  late_marks        integer not null default 0 check (late_marks >= 0),

  -- Papperskorgen. Invariant 8: a worker in the bin makes their shifts count
  -- nowhere, in every read.
  deleted_at        timestamptz,
  created_at        timestamptz not null default now()
);

create unique index worker_email_key on public.worker (lower(email));
create index worker_active_idx on public.worker (id) where deleted_at is null;

-- ============================================================================
-- PROJECT
--
-- Invariant 7: every field the document needs is captured and validated at
-- creation. These are NOT NULL because discovering a blank org nummer months
-- later -- when every shift is confirmed and final -- is not recoverable.
-- ============================================================================

create table public.project (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (btrim(name) <> ''),

  -- Where the worker physically goes.
  site_address        text not null check (btrim(site_address) <> ''),

  -- The customer. All three print on every cover page, always, no toggles.
  bestallare_address  text not null check (btrim(bestallare_address) <> ''),
  bestallare_bolag    text not null check (btrim(bestallare_bolag) <> ''),
  bestallare_orgnr    text not null check (btrim(bestallare_orgnr) <> ''),

  services            text not null check (btrim(services) <> ''),
  start_date          date not null,

  -- No end date. The leader declares the work finished; it is not a field set
  -- in advance. deactivated_at carries that, and also the auto-deactivation
  -- after a period with no shifts.
  deactivated_at      timestamptz,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.account (id)
);

-- Invariant 4b: an arbetsledare confirms only for projects they are assigned
-- to. A per-row scope, not a role check. This table is that scope.
create table public.project_leader (
  project_id  uuid not null references public.project (id) on delete cascade,
  account_id  uuid not null references public.account (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (project_id, account_id)
);

create index project_leader_account_idx on public.project_leader (account_id);

-- ============================================================================
-- PASS -- the demand for people
--
-- A pass is a demand, not a person's work. One pass with headcount 3 is one
-- row, not three. Splitting pass from tilldelning is the load-bearing
-- decision: without it, "this shift needs three people and one slot is open"
-- cannot be expressed at all.
-- ============================================================================

-- Skapa Pass generates many passes at once -- two template rows across twelve
-- days is twenty-four passes. Hand-picking is scoped to that batch ("top-ranked
-- for this batch"), so the batch needs to be a thing that exists.
create table public.pass_batch (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.project (id) on delete cascade,
  created_by  uuid not null references public.account (id),
  created_at  timestamptz not null default now()
);

create table public.pass_batch_handpick (
  batch_id   uuid not null references public.pass_batch (id) on delete cascade,
  worker_id  uuid not null references public.worker (id) on delete cascade,
  primary key (batch_id, worker_id)
);

comment on table public.pass_batch_handpick is
  'Hand-picking does not assign. It is a ranking modifier on forval: the '
  'forval is the entry ticket, and a hand-picked worker who did not mark the '
  'day is simply not on the list. That is not a mistake and needs no warning.';

create table public.pass (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.project (id) on delete cascade,
  batch_id       uuid references public.pass_batch (id) on delete set null,

  -- A plain date, deliberately. Invariant 9: the calendar day is Stockholm's,
  -- and a timestamptz here would drift the day across the UTC boundary.
  work_date      date not null,
  start_time     time not null,
  end_time       time not null,

  -- Invariant 1: typed by a human. NOT a generated column, and nothing in this
  -- migration derives it from (end_time - start_time). Unpaid lunch makes span
  -- != hours the normal case, so a derived value would be quietly wrong.
  planned_hours  numeric(4, 2) not null check (planned_hours > 0 and planned_hours <= 24),

  headcount      smallint not null check (headcount between 1 and 99),

  deleted_at     timestamptz,
  deleted_by     uuid references public.account (id),
  created_by     uuid not null references public.account (id),
  created_at     timestamptz not null default now()
);

create index pass_project_date_idx on public.pass (project_id, work_date) where deleted_at is null;
create index pass_date_idx on public.pass (work_date) where deleted_at is null;

-- ============================================================================
-- TILLDELNING -- one worker's place on one pass
-- ============================================================================

create table public.tilldelning (
  id                 uuid primary key default gen_random_uuid(),
  pass_id            uuid not null references public.pass (id) on delete cascade,
  worker_id          uuid not null references public.worker (id) on delete restrict,
  source             public.assignment_source not null,

  -- Denormalised from pass.work_date and kept in sync by trigger. Invariant 2
  -- needs a unique index over (worker, date), and an index cannot reach through
  -- a foreign key to get the date.
  work_date          date not null,

  -- Invariant 3: append-only evidence. clock_in/out are the working values the
  -- leader may overwrite; *_original holds the untouched first value and can
  -- never be rewritten. Every change is also appended to clock_edit.
  clock_in           timestamptz,
  clock_out          timestamptz,
  clock_in_original  timestamptz,
  clock_out_original timestamptz,

  -- One row, one late mark, however many of the three fields were edited.
  late               boolean not null default false,

  -- Invariant 1 again, per person. NULL means not confirmed; 0 means confirmed
  -- no-show. Conflating those two puts a false claim in a legal document.
  confirmed_hours    numeric(4, 2) check (confirmed_hours >= 0 and confirmed_hours <= 24),

  -- A released assignment is never deleted: Step 5b needs to know who was
  -- taken off so the pass is never re-offered to them.
  released_at        timestamptz,
  released_reason    public.release_reason,
  released_by        uuid references public.account (id),

  created_at         timestamptz not null default now(),

  constraint release_fields_together check (
    (released_at is null and released_reason is null)
    or (released_at is not null and released_reason is not null)
  )
);

-- INVARIANT 2 -- no worker holds two assignments on the same date. Ever.
-- Partial: a released assignment no longer occupies the day, which is what
-- lets a Snabb Pass take over from an earlier assignment (Step 7).
create unique index tilldelning_one_per_worker_per_day
  on public.tilldelning (worker_id, work_date)
  where released_at is null;

create index tilldelning_pass_idx on public.tilldelning (pass_id) where released_at is null;
create index tilldelning_worker_idx on public.tilldelning (worker_id);

-- Invariant 3, the append-only half. Every clock edit, with the editor.
create table public.clock_edit (
  id             bigint generated always as identity primary key,
  tilldelning_id uuid not null references public.tilldelning (id) on delete cascade,
  field          text not null check (field in ('clock_in', 'clock_out')),
  old_value      timestamptz,
  new_value      timestamptz,
  edited_by      uuid not null references public.account (id),
  edited_at      timestamptz not null default now()
);

create index clock_edit_tilldelning_idx on public.clock_edit (tilldelning_id, edited_at);

-- ============================================================================
-- PROJECT_DAY -- the Gjorde text and the confirmation, one row
--
-- Spec Section 3 lists Dagsbeskrivning as its own entity, and Step 8 splits
-- confirmation by day + project. Both are keyed by exactly (project, date),
-- and the Gjorde text is a precondition of the confirmation. Two tables with
-- identical keys would let a confirmation exist without its description, and
-- the rule "mandatory before that day can be confirmed" would have to be a
-- cross-table trigger instead of the CHECK below.
-- ============================================================================

create table public.project_day (
  project_id    uuid not null references public.project (id) on delete cascade,
  work_date     date not null,

  -- The VAD VI GJORDE column. Prints on every row of that day's table.
  vad_vi_gjorde text,

  confirmed_at  timestamptz,
  confirmed_by  uuid references public.account (id),

  -- Bristsurvey. 'leader' is the arbetsledare assigned to the project,
  -- confirming what they saw. 'bristsurvey' is the admin reconstructing a day
  -- the leader never closed -- registered figures, rung round and typed in.
  -- Both produce a confirmed day; only this column says which happened.
  confirmed_via public.confirmation_source,

  created_at    timestamptz not null default now(),
  primary key (project_id, work_date),

  -- Step 8: the "Vad Vi Gjorde" text is mandatory before that day's confirm
  -- becomes pressable. Enforced here, not in the interface.
  constraint vad_vi_gjorde_required_to_confirm check (
    confirmed_at is null or (vad_vi_gjorde is not null and btrim(vad_vi_gjorde) <> '')
  ),
  -- A confirmed day always knows who closed it and by which route. There is no
  -- confirmation without provenance.
  constraint confirmed_fields_together check (
    (confirmed_at is null and confirmed_by is null and confirmed_via is null)
    or (confirmed_at is not null and confirmed_by is not null and confirmed_via is not null)
  )
);

create index project_day_survey_idx on public.project_day (project_id, work_date)
  where confirmed_via = 'bristsurvey';

-- ============================================================================
-- FORVAL -- availability
--
-- Worker plus date, can-work or can't-work. Not tied to a project or a shift.
-- Writes nothing anywhere until a leader creates a shift on that day.
-- ============================================================================

create table public.forval (
  worker_id  uuid not null references public.worker (id) on delete cascade,
  work_date  date not null,
  can_work   boolean not null,
  updated_at timestamptz not null default now(),
  primary key (worker_id, work_date)
);

create index forval_date_idx on public.forval (work_date, can_work);

-- ============================================================================
-- OFFERS -- Acceptera Pass (Tier 3) and the Step 5b cascade
-- ============================================================================

create table public.pass_offer (
  id           uuid primary key default gen_random_uuid(),
  pass_id      uuid not null references public.pass (id) on delete cascade,
  worker_id    uuid not null references public.worker (id) on delete cascade,
  state        public.offer_state not null default 'offered',
  offered_at   timestamptz not null default now(),
  responded_at timestamptz,
  unique (pass_id, worker_id)
);

create index pass_offer_open_idx on public.pass_offer (worker_id) where state = 'offered';

-- "A deleted shift is never re-offered to the people removed from it. They
-- were taken off for a reason." Also covers Step 5b removals. If the admin
-- changes their mind, a Snabb Pass puts them back.
create table public.pass_block (
  pass_id    uuid not null references public.pass (id) on delete cascade,
  worker_id  uuid not null references public.worker (id) on delete cascade,
  blocked_at timestamptz not null default now(),
  primary key (pass_id, worker_id)
);

-- ============================================================================
-- ARBETSDAGBOK -- which ranges have already been documented
--
-- A project produces many documents over its life. The admin picks a range by
-- hand each time, so without this a week can be logged twice or missed
-- entirely and nothing in the app would show it. Overlap is a warning, not a
-- block -- re-issuing a document is legitimate, it just must never happen
-- unknowingly.
-- ============================================================================

create table public.arbetsdagbok (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.project (id) on delete cascade,

  -- Half-open [start, end). Invariant 9: month and range windows are
  -- half-open, so adjacent documents abut without overlapping by a day.
  covered      daterange not null,

  generated_at timestamptz not null default now(),
  generated_by uuid not null references public.account (id),

  constraint covered_is_half_open check (
    lower_inc(covered) and not upper_inc(covered) and not isempty(covered)
  )
);

-- Makes the overlap warning a single indexed query rather than a scan.
create index arbetsdagbok_overlap_idx on public.arbetsdagbok using gist (project_id, covered);

-- ============================================================================
-- NOTIFICATIONS -- in-app only
--
-- A red dot and a message on next load. The two things that actually need to
-- travel are a deleted shift and an offered one.
-- ============================================================================

create table public.notification (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  kind       public.notification_kind not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index notification_unread_idx on public.notification (account_id, created_at desc)
  where read_at is null;

-- ============================================================================
-- WHO IS ASKING
--
-- Role is read from the database, never from the JWT (Section 6), so a role
-- change takes effect on next load rather than persisting stale for the
-- token's lifetime. SECURITY DEFINER so these can be used inside the policies
-- on public.account itself without recursing through its own RLS.
-- ============================================================================

create or replace function app.current_role() returns public.app_role
  language sql stable security definer
  set search_path = ''
as $$
  select a.role from public.account a
  where a.id = (select auth.uid()) and a.active
$$;

create or replace function app.is_admin() returns boolean
  language sql stable security definer
  set search_path = ''
as $$ select coalesce(app.current_role() = 'admin', false) $$;

-- Admin can do everything an arbetsledare can (Section 2).
create or replace function app.is_staff() returns boolean
  language sql stable security definer
  set search_path = ''
as $$ select coalesce(app.current_role() in ('admin', 'arbetsledare'), false) $$;

create or replace function app.current_worker_id() returns uuid
  language sql stable security definer
  set search_path = ''
as $$
  select w.id from public.worker w
  where w.account_id = (select auth.uid()) and w.deleted_at is null
$$;

-- INVARIANT 4b -- per-row project scope, not a role check.
create or replace function app.leads_project(p_project uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select app.is_admin()
      or exists (
        select 1 from public.project_leader pl
        where pl.project_id = p_project and pl.account_id = (select auth.uid())
      )
$$;

-- INVARIANT 4b, and the one place the admin is NOT above the leader.
--
-- "The admin cannot confirm days. Only the assigned arbetsledare can. That is
-- the pressure the whole system runs on, and removing it would let the owner
-- rubber-stamp days he was not present for." (Spec Section 1.)
--
-- Deliberately does not fall back to is_admin(). When days are missing the
-- admin goes through the bristsurvey, which confirms with different
-- provenance -- never by pretending to be the leader.
create or replace function app.confirms_project(p_project uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.project_leader pl
    where pl.project_id = p_project and pl.account_id = (select auth.uid())
  )
$$;

-- ============================================================================
-- TRIGGERS -- the invariants
-- ============================================================================

-- Invariant 2's index needs the date on the row. Keep it honest.
create or replace function app.tg_sync_work_date() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  select p.work_date into new.work_date from public.pass p where p.id = new.pass_id;
  if new.work_date is null then
    raise exception 'pass % does not exist', new.pass_id;
  end if;
  return new;
end $$;

create trigger sync_work_date
  before insert or update of pass_id on public.tilldelning
  for each row execute function app.tg_sync_work_date();

-- Step 4, Tier 3: "Two workers racing for the last slot resolve to exactly one
-- winner, enforced in the database." The row lock serialises the racers; the
-- count then sees a stable world.
create or replace function app.tg_headcount_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_headcount smallint;
  v_taken     integer;
begin
  -- Only when the row starts or resumes occupying a slot.
  if tg_op = 'UPDATE' and not (old.released_at is not null and new.released_at is null) then
    return new;
  end if;

  select p.headcount into v_headcount
  from public.pass p where p.id = new.pass_id
  for update;

  select count(*) into v_taken
  from public.tilldelning t
  where t.pass_id = new.pass_id
    and t.released_at is null
    and t.id is distinct from new.id;

  if v_taken >= v_headcount then
    raise exception 'pass % is full (% of % slots taken)', new.pass_id, v_taken, v_headcount
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger headcount_guard
  before insert or update of released_at on public.tilldelning
  for each row execute function app.tg_headcount_guard();

-- "A deleted shift is never re-offered to the people removed from it." Snabb
-- Pass is the deliberate way back, so it is the one source that ignores this.
create or replace function app.tg_block_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if new.source <> 'snabb'
     and exists (select 1 from public.pass_block b
                 where b.pass_id = new.pass_id and b.worker_id = new.worker_id) then
    raise exception 'worker % was removed from pass % and is not re-offered it; use a Snabb Pass',
      new.worker_id, new.pass_id using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger block_guard
  before insert on public.tilldelning
  for each row execute function app.tg_block_guard();

-- INVARIANT 3 -- clock stamps are append-only evidence.
--
-- The worker's own clock-in takes the server's clock, never a value they sent:
-- a phone running ten minutes fast would write ten minutes of error into
-- evidence of hours worked and nobody would notice. A leader may overwrite the
-- working value; the original survives and every change is appended to
-- clock_edit with the editor's identity.
create or replace function app.tg_clock_evidence() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_staff boolean := app.is_staff();
begin
  if tg_op = 'INSERT' then
    if new.clock_in is not null and not v_staff then
      new.clock_in := now();
    end if;
    if new.clock_out is not null and not v_staff then
      new.clock_out := now();
    end if;
    new.clock_in_original  := new.clock_in;
    new.clock_out_original := new.clock_out;
    return new;
  end if;

  -- Written once, then never again. NULL -> value is the initial capture the
  -- trigger itself performs below; value -> anything else is tampering.
  if (old.clock_in_original is not null
      and new.clock_in_original is distinct from old.clock_in_original)
     or (old.clock_out_original is not null
         and new.clock_out_original is distinct from old.clock_out_original) then
    raise exception 'clock stamp originals are append-only evidence and cannot be changed'
      using errcode = 'check_violation';
  end if;

  if new.clock_in is distinct from old.clock_in then
    if not v_staff then
      if old.clock_in is not null then
        raise exception 'only a leader may change a clock stamp once it is set'
          using errcode = 'insufficient_privilege';
      end if;
      new.clock_in := now();
    end if;
    if old.clock_in is null then
      new.clock_in_original := new.clock_in;
    end if;
    insert into public.clock_edit (tilldelning_id, field, old_value, new_value, edited_by)
    values (new.id, 'clock_in', old.clock_in, new.clock_in, v_actor);
  end if;

  if new.clock_out is distinct from old.clock_out then
    if not v_staff then
      if old.clock_out is not null then
        raise exception 'only a leader may change a clock stamp once it is set'
          using errcode = 'insufficient_privilege';
      end if;
      new.clock_out := now();
    end if;
    if old.clock_out is null then
      new.clock_out_original := new.clock_out;
    end if;
    insert into public.clock_edit (tilldelning_id, field, old_value, new_value, edited_by)
    values (new.id, 'clock_out', old.clock_out, new.clock_out, v_actor);
  end if;

  return new;
end $fn$;

create trigger clock_evidence
  before insert or update on public.tilldelning
  for each row execute function app.tg_clock_evidence();

-- INVARIANT 4  -- only a leader writes hours or confirmation state.
-- INVARIANT 4b -- and only on a project they are assigned to.
-- INVARIANT 5  -- confirmation is final.
--
-- Column grants cannot express this: every logged-in user is the same database
-- role, so a grant that restricts arbetare restricts arbetsledare identically.
-- Comparing OLD and NEW is the mechanism that works.
create or replace function app.tg_assignment_write_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_project   uuid;
  v_confirmed timestamptz;
  v_row       public.tilldelning;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;

  select p.project_id, pd.confirmed_at into v_project, v_confirmed
  from public.pass p
  left join public.project_day pd
    on pd.project_id = p.project_id and pd.work_date = p.work_date
  where p.id = v_row.pass_id;

  -- INVARIANT 5. The day is closed; nothing about it moves again.
  if v_confirmed is not null then
    raise exception 'day % is confirmed and final; no edits after', v_row.work_date
      using errcode = 'insufficient_privilege';
  end if;

  -- INVARIANT 4 + 4b. Hours and the late mark are the leader's alone.
  if tg_op = 'UPDATE'
     and (new.confirmed_hours is distinct from old.confirmed_hours
          or new.late is distinct from old.late)
     and not app.leads_project(v_project) then
    raise exception 'only an arbetsledare assigned to this project may write hours or the late mark'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;

create trigger assignment_write_guard
  before update or delete on public.tilldelning
  for each row execute function app.tg_assignment_write_guard();

-- Step 8, and INVARIANT 5's other half: a confirmation is never lifted.
create or replace function app.tg_confirmation_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_last_end timestamptz;
  v_missing  integer;
begin
  if tg_op = 'DELETE' then
    if old.confirmed_at is not null then
      raise exception 'a confirmed day cannot be deleted'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.confirmed_at is not null then
    raise exception 'day % on project % is confirmed and final; no edits after',
      old.work_date, old.project_id using errcode = 'insufficient_privilege';
  end if;

  -- Writing the "Vad Vi Gjorde" text is the leader's on their own projects, and
  -- the admin's when filling a bristsurvey. Confirming is narrower -- below.
  if not app.leads_project(new.project_id) then
    raise exception 'not your project'
      using errcode = 'insufficient_privilege';
  end if;

  if new.confirmed_at is not null then
    -- WHO CLOSED THE DAY, AND BY WHICH ROUTE.
    --
    -- 'leader'      -- the assigned arbetsledare, and only them. is_admin()
    --                  does not satisfy this: letting the owner confirm as a
    --                  leader would remove the pressure the system runs on and
    --                  rubber-stamp days he was not present for.
    -- 'bristsurvey' -- the admin, reconstructing a day the leader never closed.
    --                  A surveyed day is a confirmed day and never returns to
    --                  the leader's queue, so the record has to say it was the
    --                  owner who took the shot.
    if new.confirmed_via = 'leader' then
      if not app.confirms_project(new.project_id) then
        raise exception 'only the arbetsledare assigned to this project may confirm its days; the admin fills gaps through the bristsurvey'
          using errcode = 'insufficient_privilege';
      end if;
    elsif new.confirmed_via = 'bristsurvey' then
      if not app.is_admin() then
        raise exception 'only an admin completes a bristsurvey'
          using errcode = 'insufficient_privilege';
      end if;
    else
      raise exception 'a confirmed day must record how it was confirmed'
        using errcode = 'check_violation';
    end if;

    -- Step 8: confirmable the minute its last shift has ended -- by the clock,
    -- not at midnight and not the next morning.
    select max(app.pass_end_at(p.work_date, p.start_time, p.end_time)) into v_last_end
    from public.pass p
    where p.project_id = new.project_id and p.work_date = new.work_date
      and p.deleted_at is null;

    if v_last_end is null then
      raise exception 'no shifts on % for this project; nothing to confirm', new.work_date
        using errcode = 'check_violation';
    end if;

    if now() < v_last_end then
      raise exception 'day % is not over yet; its last shift ends %', new.work_date, v_last_end
        using errcode = 'check_violation';
    end if;

    -- Section 9: NULL means not confirmed, 0 means confirmed no-show.
    -- Confirming may not leave anyone's hours unset, or that NULL would later
    -- be read as a zero and put a false claim in a legal document.
    select count(*) into v_missing
    from public.tilldelning t
    join public.pass p on p.id = t.pass_id
    where p.project_id = new.project_id and p.work_date = new.work_date
      and p.deleted_at is null and t.released_at is null
      and t.confirmed_hours is null;

    if v_missing > 0 then
      raise exception '% assignment(s) on % still have no confirmed hours',
        v_missing, new.work_date using errcode = 'check_violation';
    end if;

    new.confirmed_by := (select auth.uid());

    -- Cumulative and permanent. Never decremented, so removing the assignment
    -- afterwards cannot launder the demotion away.
    update public.worker w
    set late_marks = w.late_marks + 1
    where w.id in (
      select t.worker_id from public.tilldelning t
      join public.pass p on p.id = t.pass_id
      where p.project_id = new.project_id and p.work_date = new.work_date
        and p.deleted_at is null and t.released_at is null and t.late
    );
  end if;

  return new;
end $fn$;

create trigger confirmation_guard
  before insert or update or delete on public.project_day
  for each row execute function app.tg_confirmation_guard();

-- Section 2b: only admin deletes a shift, and an ongoing one cannot be deleted.
-- Once it has started it is a fact that has to be confirmed, not erased.
create or replace function app.tg_pass_delete_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'shifts are soft-deleted; set deleted_at instead'
      using errcode = 'insufficient_privilege';
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    if not app.is_admin() then
      raise exception 'only an admin may delete a shift'
        using errcode = 'insufficient_privilege';
    end if;

    if now() >= app.pass_start_at(old.work_date, old.start_time) then
      raise exception 'this shift has started and cannot be deleted; it must be confirmed'
        using errcode = 'check_violation';
    end if;

    if exists (select 1 from public.tilldelning t
               where t.pass_id = old.id and t.clock_in is not null) then
      raise exception 'someone has clocked in on this shift; it cannot be deleted'
        using errcode = 'check_violation';
    end if;

    new.deleted_by := (select auth.uid());

    -- The people on it are never re-offered it, and are told it is gone.
    insert into public.pass_block (pass_id, worker_id)
    select t.pass_id, t.worker_id from public.tilldelning t
    where t.pass_id = old.id and t.released_at is null
    on conflict do nothing;

    insert into public.notification (account_id, kind, payload)
    select w.account_id, 'shift_deleted',
           jsonb_build_object('pass_id', old.id, 'work_date', old.work_date,
                              'project_id', old.project_id)
    from public.tilldelning t
    join public.worker w on w.id = t.worker_id
    where t.pass_id = old.id and t.released_at is null;

    update public.tilldelning t
    set released_at = now(), released_reason = 'shift_deleted', released_by = (select auth.uid())
    where t.pass_id = old.id and t.released_at is null;

    update public.pass_offer o
    set state = 'withdrawn', responded_at = now()
    where o.pass_id = old.id and o.state = 'offered';
  end if;

  return new;
end $fn$;

create trigger pass_delete_guard
  before update or delete on public.pass
  for each row execute function app.tg_pass_delete_guard();

-- INVARIANT 11 -- the last active leader cannot be removed, demoted or paused.
-- Otherwise nobody can promote anyone back and the system needs direct
-- database access to recover.
--
-- "Leader" here is read as admin: admin is the only role that can change a
-- role, so admin is the one whose disappearance is unrecoverable.
create or replace function app.tg_last_admin_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_remaining integer;
  v_was_admin boolean;
begin
  v_was_admin := (old.role = 'admin' and old.active);

  if not v_was_admin then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.role = 'admin' and new.active then
    return new;  -- still an active admin, nothing lost
  end if;

  select count(*) into v_remaining
  from public.account a
  where a.role = 'admin' and a.active and a.id <> old.id;

  if v_remaining = 0 then
    raise exception 'this is the last active admin; it cannot be removed, demoted or paused'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;

create trigger last_admin_guard
  before update or delete on public.account
  for each row execute function app.tg_last_admin_guard();

-- INVARIANT 6 -- the Arbetsdagbok cannot generate with any cell empty.
--
-- Stricter than "all shifts confirmed". Every one of these must hold, and a
-- row in public.arbetsdagbok IS the generation, so the guard sits on its
-- insert. This block is the entire enforcement mechanism: the admin needs the
-- document, only the leader can unblock it.
create or replace function app.tg_arbetsdagbok_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_project     public.project;
  v_unconfirmed integer;
  v_no_gjorde   integer;
  v_days        integer;
begin
  if not app.is_admin() then
    raise exception 'only an admin generates the Arbetsdagbok'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_project from public.project p where p.id = new.project_id;

  -- INVARIANT 8: a project in the bin makes its shifts count nowhere.
  if v_project.deleted_at is not null then
    raise exception 'project is deleted; it cannot produce a document'
      using errcode = 'check_violation';
  end if;

  -- The four cover values. NOT NULL already; this catches whitespace.
  if btrim(v_project.name) = ''
     or btrim(v_project.bestallare_address) = ''
     or btrim(v_project.bestallare_bolag) = ''
     or btrim(v_project.bestallare_orgnr) = '' then
    raise exception 'the bestallare block is incomplete; the document cannot identify the customer'
      using errcode = 'check_violation';
  end if;

  -- Every day in range that has shifts must be confirmed, and carry a Gjorde.
  select count(*) into v_days
  from public.pass p
  where p.project_id = new.project_id
    and p.deleted_at is null
    and p.work_date <@ new.covered;

  if v_days = 0 then
    raise exception 'no shifts in the chosen range; there is nothing to document'
      using errcode = 'check_violation';
  end if;

  select count(distinct p.work_date) into v_unconfirmed
  from public.pass p
  left join public.project_day pd
    on pd.project_id = p.project_id and pd.work_date = p.work_date
  where p.project_id = new.project_id
    and p.deleted_at is null
    and p.work_date <@ new.covered
    and pd.confirmed_at is null;

  if v_unconfirmed > 0 then
    raise exception '% day(s) in this range are not confirmed; complete the bristsurvey', v_unconfirmed
      using errcode = 'check_violation';
  end if;

  select count(distinct p.work_date) into v_no_gjorde
  from public.pass p
  left join public.project_day pd
    on pd.project_id = p.project_id and pd.work_date = p.work_date
  where p.project_id = new.project_id
    and p.deleted_at is null
    and p.work_date <@ new.covered
    and (pd.vad_vi_gjorde is null or btrim(pd.vad_vi_gjorde) = '');

  if v_no_gjorde > 0 then
    raise exception '% day(s) in this range have no "Vad Vi Gjorde" description; complete the bristsurvey', v_no_gjorde
      using errcode = 'check_violation';
  end if;

  new.generated_by := (select auth.uid());
  return new;
end $fn$;

create trigger arbetsdagbok_guard
  before insert on public.arbetsdagbok
  for each row execute function app.tg_arbetsdagbok_guard();

-- A worker fills their own profile. Name and email are the admin's, and
-- late_marks are the priority list's -- neither is the worker's to move.
create or replace function app.tg_worker_self_edit_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  if app.is_admin() then
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

create trigger worker_self_edit_guard
  before update on public.worker
  for each row execute function app.tg_worker_self_edit_guard();

-- ============================================================================
-- RPCs -- the writes a worker is allowed to make
--
-- Workers get no direct write on tilldelning. Clocking and accepting go
-- through these, so the rules cannot be sidestepped by a hand-built PostgREST
-- request.
-- ============================================================================

-- Step 6: the timestamp is the server's, never the phone's.
create or replace function public.clock_in(p_tilldelning uuid) returns timestamptz
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_worker uuid := app.current_worker_id();
  v_now    timestamptz := now();
begin
  update public.tilldelning t
  set clock_in = v_now
  where t.id = p_tilldelning
    and t.worker_id = v_worker
    and t.released_at is null
    and t.clock_in is null;

  if not found then
    raise exception 'not your shift, already clocked in, or no longer assigned'
      using errcode = 'insufficient_privilege';
  end if;
  return v_now;
end $fn$;

create or replace function public.clock_out(p_tilldelning uuid) returns timestamptz
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_worker uuid := app.current_worker_id();
  v_now    timestamptz := now();
begin
  update public.tilldelning t
  set clock_out = v_now
  where t.id = p_tilldelning
    and t.worker_id = v_worker
    and t.released_at is null
    and t.clock_in is not null
    and t.clock_out is null;

  if not found then
    raise exception 'not your shift, not clocked in, or already clocked out'
      using errcode = 'insufficient_privilege';
  end if;
  return v_now;
end $fn$;

-- Step 4, Tier 3. "First accepted wins; the slot closes instantly. Two workers
-- racing for the last slot resolve to exactly one winner, enforced in the
-- database." The headcount trigger takes the pass row lock; the loser gets the
-- check_violation and a clean message.
create or replace function public.accept_offer(p_pass uuid) returns uuid
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_worker uuid := app.current_worker_id();
  v_id     uuid;
begin
  if v_worker is null then
    raise exception 'no worker record for this account' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.pass_offer o
                 where o.pass_id = p_pass and o.worker_id = v_worker and o.state = 'offered') then
    raise exception 'this shift is not offered to you' using errcode = 'insufficient_privilege';
  end if;

  -- INVARIANT 2 is the partial unique index; this is the friendly message.
  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  values (p_pass, v_worker, 'oppen', (select p.work_date from public.pass p where p.id = p_pass))
  returning id into v_id;

  update public.pass_offer o set state = 'accepted', responded_at = now()
  where o.pass_id = p_pass and o.worker_id = v_worker;

  -- The pass vanishes from everyone else's queue once headcount is met.
  update public.pass_offer o set state = 'withdrawn', responded_at = now()
  where o.pass_id = p_pass and o.state = 'offered'
    and (select count(*) from public.tilldelning t
         where t.pass_id = p_pass and t.released_at is null)
        >= (select p.headcount from public.pass p where p.id = p_pass);

  return v_id;
end $fn$;

create or replace function public.decline_offer(p_pass uuid) returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  update public.pass_offer o set state = 'declined', responded_at = now()
  where o.pass_id = p_pass and o.worker_id = app.current_worker_id() and o.state = 'offered';
end $fn$;

-- Step 7: "If that person held an assignment elsewhere that day, the Snabb
-- Pass wins and the earlier one is released." Both halves in one transaction,
-- so INVARIANT 2 is never momentarily false.
create or replace function public.assign_snabb(p_pass uuid, p_worker uuid) returns uuid
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_date date;
  v_id   uuid;
begin
  if not app.is_admin() then
    raise exception 'only an admin creates a Snabb Pass' using errcode = 'insufficient_privilege';
  end if;

  select p.work_date into v_date from public.pass p where p.id = p_pass and p.deleted_at is null;
  if v_date is null then
    raise exception 'no such shift' using errcode = 'check_violation';
  end if;

  update public.tilldelning t
  set released_at = now(), released_reason = 'replaced_by_snabb', released_by = (select auth.uid())
  where t.worker_id = p_worker and t.work_date = v_date and t.released_at is null;

  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  values (p_pass, p_worker, 'snabb', v_date)
  returning id into v_id;

  return v_id;
end $fn$;

-- Section 2b: soft-delete a shift.
--
-- This MUST be an RPC and cannot be a plain UPDATE from the client. Postgres
-- re-applies row level security to the row a BEFORE UPDATE trigger produces,
-- and pass_leader_select carries "deleted_at is null" for invariant 8 -- so the
-- moment deleted_at is set the new row fails its own SELECT policy and the
-- update is rejected. Setting deleted_at directly is therefore impossible for
-- every role, admin included.
--
-- Keeping the filter in the policy (rather than trusting callers to add
-- "where deleted_at is null") is the point: invariant 8 says deleted things
-- count nowhere in EVERY read. So deletion goes through here instead, and
-- pass_delete_guard still applies every rule -- admin only, never once started.
create or replace function public.delete_pass(p_pass uuid) returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  update public.pass set deleted_at = now()
  where id = p_pass and deleted_at is null;

  if not found then
    raise exception 'no such shift, or it is already deleted' using errcode = 'check_violation';
  end if;
end $fn$;

-- Step 5b: the vacated slot reopens. Headcount does not drop.
create or replace function public.release_assignment(
  p_tilldelning uuid,
  p_reason public.release_reason default 'removed_by_leader'
) returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_project uuid;
  v_row     public.tilldelning;
begin
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;

  select p.project_id into v_project from public.pass p where p.id = v_row.pass_id;
  if not app.leads_project(v_project) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  update public.tilldelning t
  set released_at = now(), released_reason = p_reason, released_by = (select auth.uid())
  where t.id = p_tilldelning and t.released_at is null;

  -- Never re-offered to the person taken off. Snabb Pass is the way back.
  insert into public.pass_block (pass_id, worker_id) values (v_row.pass_id, v_row.worker_id)
  on conflict do nothing;
end $fn$;

-- ============================================================================
-- VIEWS
--
-- These exist because RLS is row-level and two rules here are column-level:
--   - "a worker must never see a colleague's personal data" (Section 3)
--   - INVARIANT 10, confirmed hours are the only hours shown to a worker
--
-- Column grants cannot express either -- every logged-in user is the same
-- database role. So the tables stay closed and these views, which run as
-- owner, carry an explicit guard in their own WHERE clause.
-- ============================================================================

-- Names for scheduling. No personnummer, no bank details, staff only.
create view public.worker_roster with (security_invoker = false) as
select w.id, w.name, w.late_marks
from public.worker w
where w.deleted_at is null       -- INVARIANT 8
  and app.is_staff();

-- The nullable side of the identity relationship, as spec Section 3 describes
-- it: not every account has a worker.
create view public.account_directory with (security_invoker = false) as
select a.id, a.role, a.active, w.id as worker_id, w.name
from public.account a
left join public.worker w on w.account_id = a.id and w.deleted_at is null
where app.is_admin() or a.id = (select auth.uid());

-- INVARIANT 10. A number that shrinks when someone corrects it is worse than
-- no number, so hours stay null to the worker until the day is confirmed.
create view public.my_shift with (security_invoker = false) as
select
  t.id,
  t.pass_id,
  p.project_id,
  pr.name          as project_name,
  pr.site_address,
  p.work_date,
  p.start_time,
  p.end_time,
  p.planned_hours,
  t.clock_in,
  t.clock_out,
  case when pd.confirmed_at is not null then t.confirmed_hours end as confirmed_hours,
  (pd.confirmed_at is not null) as day_confirmed
from public.tilldelning t
join public.pass p    on p.id = t.pass_id  and p.deleted_at is null
join public.project pr on pr.id = p.project_id and pr.deleted_at is null   -- INVARIANT 8
left join public.project_day pd
       on pd.project_id = p.project_id and pd.work_date = p.work_date
where t.released_at is null
  and t.worker_id = app.current_worker_id();

-- Acceptera Pass. The Step 3 exclusion filter is part of the read: a worker
-- who already holds an assignment that date is not shown the card at all.
create view public.my_offer with (security_invoker = false) as
select
  o.pass_id, p.work_date, p.start_time, p.end_time, p.planned_hours,
  pr.name as project_name, pr.site_address
from public.pass_offer o
join public.pass p     on p.id = o.pass_id and p.deleted_at is null
join public.project pr on pr.id = p.project_id and pr.deleted_at is null
where o.state = 'offered'
  and o.worker_id = app.current_worker_id()
  and not exists (
    select 1 from public.tilldelning t
    where t.worker_id = o.worker_id and t.work_date = p.work_date and t.released_at is null
  );

-- ============================================================================
-- ROW LEVEL SECURITY
--
-- Enabled on every table. An unauthenticated visitor who bypassed the login
-- gate sees empty lists because the database refuses them, not because the
-- interface hid anything. anon is granted nothing at all.
-- ============================================================================

alter table public.account             enable row level security;
alter table public.worker              enable row level security;
alter table public.project             enable row level security;
alter table public.project_leader      enable row level security;
alter table public.pass_batch          enable row level security;
alter table public.pass_batch_handpick enable row level security;
alter table public.pass                enable row level security;
alter table public.tilldelning         enable row level security;
alter table public.clock_edit          enable row level security;
alter table public.project_day         enable row level security;
alter table public.forval              enable row level security;
alter table public.pass_offer          enable row level security;
alter table public.pass_block          enable row level security;
alter table public.arbetsdagbok        enable row level security;
alter table public.notification        enable row level security;

-- account -----------------------------------------------------------------
create policy account_self_or_admin_select on public.account
  for select to authenticated
  using (id = (select auth.uid()) or app.is_admin());

create policy account_admin_write on public.account
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- worker ------------------------------------------------------------------
-- Own row in full; everyone else's names come from worker_roster instead.
create policy worker_self_or_admin_select on public.worker
  for select to authenticated
  using (account_id = (select auth.uid()) or app.is_admin());

create policy worker_self_profile_update on public.worker
  for update to authenticated
  using (account_id = (select auth.uid()) or app.is_admin())
  with check (account_id = (select auth.uid()) or app.is_admin());

create policy worker_admin_insert on public.worker
  for insert to authenticated with check (app.is_admin());

-- project -----------------------------------------------------------------
create policy project_staff_select on public.project
  for select to authenticated
  using (deleted_at is null and app.leads_project(id));

create policy project_admin_write on public.project
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- project_leader ----------------------------------------------------------
create policy project_leader_staff_select on public.project_leader
  for select to authenticated
  using (app.is_staff());

create policy project_leader_admin_write on public.project_leader
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- pass_batch / handpicks --------------------------------------------------
create policy pass_batch_leader on public.pass_batch
  for all to authenticated
  using (app.leads_project(project_id)) with check (app.leads_project(project_id));

create policy handpick_leader on public.pass_batch_handpick
  for all to authenticated
  using (exists (select 1 from public.pass_batch b
                 where b.id = batch_id and app.leads_project(b.project_id)))
  with check (exists (select 1 from public.pass_batch b
                      where b.id = batch_id and app.leads_project(b.project_id)));

-- pass --------------------------------------------------------------------
-- Skapa Pass's project dropdown lists only assigned projects, which is what
-- makes an unassigned arbetsledare harmless. This is that rule in the database.
create policy pass_leader_select on public.pass
  for select to authenticated
  using (deleted_at is null and app.leads_project(project_id));

create policy pass_leader_insert on public.pass
  for insert to authenticated with check (app.leads_project(project_id));

create policy pass_leader_update on public.pass
  for update to authenticated
  using (app.leads_project(project_id)) with check (app.leads_project(project_id));

-- tilldelning -------------------------------------------------------------
-- Staff only. Workers read my_shift and write through the RPCs, so there is no
-- path by which a hand-built PostgREST request reaches this table as a worker.
create policy tilldelning_leader_select on public.tilldelning
  for select to authenticated
  using (exists (select 1 from public.pass p
                 where p.id = pass_id and app.leads_project(p.project_id)));

create policy tilldelning_leader_write on public.tilldelning
  for all to authenticated
  using (exists (select 1 from public.pass p
                 where p.id = pass_id and app.leads_project(p.project_id)))
  with check (exists (select 1 from public.pass p
                      where p.id = pass_id and app.leads_project(p.project_id)));

-- clock_edit --------------------------------------------------------------
-- INVARIANT 3: append-only. No update policy, no delete policy, and no insert
-- policy either -- only the clock_evidence trigger writes here.
create policy clock_edit_leader_select on public.clock_edit
  for select to authenticated
  using (exists (select 1 from public.tilldelning t
                 join public.pass p on p.id = t.pass_id
                 where t.id = tilldelning_id and app.leads_project(p.project_id)));

-- project_day -------------------------------------------------------------
create policy project_day_leader on public.project_day
  for all to authenticated
  using (app.leads_project(project_id)) with check (app.leads_project(project_id));

-- forval ------------------------------------------------------------------
-- The leader reads it to build the priority list; only the worker writes it.
create policy forval_select on public.forval
  for select to authenticated
  using (app.is_staff() or worker_id = app.current_worker_id());

create policy forval_own_write on public.forval
  for all to authenticated
  using (worker_id = app.current_worker_id())
  with check (worker_id = app.current_worker_id());

-- pass_offer / pass_block -------------------------------------------------
create policy pass_offer_select on public.pass_offer
  for select to authenticated
  using (app.is_staff() or worker_id = app.current_worker_id());

create policy pass_offer_leader_write on public.pass_offer
  for all to authenticated
  using (exists (select 1 from public.pass p
                 where p.id = pass_id and app.leads_project(p.project_id)))
  with check (exists (select 1 from public.pass p
                      where p.id = pass_id and app.leads_project(p.project_id)));

create policy pass_block_staff_select on public.pass_block
  for select to authenticated using (app.is_staff());

-- arbetsdagbok ------------------------------------------------------------
create policy arbetsdagbok_admin on public.arbetsdagbok
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- notification ------------------------------------------------------------
create policy notification_own_select on public.notification
  for select to authenticated
  using (account_id = (select auth.uid()));

create policy notification_own_update on public.notification
  for update to authenticated
  using (account_id = (select auth.uid()))
  with check (account_id = (select auth.uid()));

-- ============================================================================
-- GRANTS
--
-- anon gets nothing. There is no read that an unauthenticated visitor is
-- entitled to, and the login gate is a courtesy, not the boundary.
-- ============================================================================

revoke all on schema app from public;
revoke all on all functions in schema app from public, anon, authenticated;

-- ...then hand execute back to authenticated only.
--
-- RLS policy expressions are evaluated with the CALLING role's privileges, not
-- the table owner's. Without this every policy referencing app.leads_project()
-- raises "permission denied for function" instead of evaluating -- which does
-- not fail open, but does mean a logged-in user can read nothing at all.
--
-- This does not expose them as RPC. PostgREST only serves functions from its
-- exposed schemas, and `app` is not one. anon stays revoked: it has no table
-- privileges either, so it is refused before a policy is ever reached.
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

grant usage on schema public to authenticated;

grant select, insert, update on
  public.account, public.worker, public.project, public.project_leader,
  public.pass_batch, public.pass_batch_handpick, public.pass,
  public.tilldelning, public.project_day, public.forval,
  public.pass_offer, public.arbetsdagbok, public.notification
  to authenticated;

grant select on public.clock_edit, public.pass_block to authenticated;

grant delete on
  public.project_leader, public.pass_batch_handpick, public.forval,
  public.project, public.worker, public.account
  to authenticated;

grant select on
  public.worker_roster, public.account_directory, public.my_shift, public.my_offer
  to authenticated;

grant execute on function
  public.clock_in(uuid), public.clock_out(uuid),
  public.accept_offer(uuid), public.decline_offer(uuid),
  public.assign_snabb(uuid, uuid),
  public.release_assignment(uuid, public.release_reason),
  public.delete_pass(uuid)
  to authenticated;

-- Belt and braces: nothing at all for the unauthenticated.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;
