-- ============================================================================
-- PERSONLIG KALENDER -- the admin's own events, shared with named people.
--
-- The shift calendar answers "who is where". This answers "what else is in the
-- way": a site visit, a meeting with a bestallare, a week off. It shares the
-- calendar screen with the shift view behind a switch and shares NOTHING else.
--
-- IT IS NOT SHIFT DATA AND MUST NEVER BECOME IT. Nothing in the tier walk, the
-- overlap test, the confirmation queues or the Arbetsdagbok reads this table,
-- and nothing here references pass, tilldelning or project_day. An event on a
-- day does not make anyone unavailable and does not print anywhere. That is
-- the whole point of keeping it in its own table rather than as a flag on an
-- existing one: a column on `pass` would eventually be read by something that
-- reads `pass`, and the document would gain a row nobody worked.
--
-- WHO SEES ONE IS A LIST, NOT A ROLE. "Everyone with role arbetsledare" would
-- be wrong the day a second admin exists or a leader leaves the firm, and a
-- boolean "private" would make sharing all-or-nothing. So visibility is rows
-- in personal_event_viewer, and the interface merely SORTS arbetsledare to the
-- top of the picker because they are who these events are usually about.
--
-- THE VISIBILITY CHECK GOES THROUGH A SECURITY DEFINER FUNCTION, and that is
-- not decoration. An RLS policy expression runs with the CALLING role's
-- privileges (CLAUDE.md, gotcha 2), so a policy on personal_event that
-- subqueried personal_event_viewer would have THAT table's RLS applied to the
-- subquery -- and its policy needs to know who owns the event, which is on
-- personal_event. Two policies each requiring the other is infinite recursion,
-- and Postgres reports it as one. The two app.* helpers below break the cycle
-- by reading each table as owner, exactly as app.leads_project() does.
--
-- THE OWNER WRITES; ANYONE MAY BE SHOWN. Writing is gated on ownership and
-- NOT on role: a personal calendar belongs to the person whose calendar it is,
-- and an owner who could not write their own events would have none to share.
-- The Personlig switch is on the admin's calendar screen for now, so the admin
-- is who reaches it -- but the interface is not the boundary here any more
-- than anywhere else, and the row's owner_id is.
--
-- DATES ARE STOCKHOLM-ANCHORED (invariant 9), stored the way pass stores them:
-- a `date` plus two `time` columns, never a timestamptz whose meaning depends
-- on the server's zone -- which is UTC here. A whole-day event carries no
-- times at all rather than 00:00-23:59, because "all day" is a different claim
-- from "a shift that happens to be long", and a check constraint keeps the two
-- from being written into the same row.
-- ============================================================================

create table public.personal_event (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.account (id) on delete cascade,
  title        text not null,
  description  text,
  event_date   date not null,
  all_day      boolean not null default false,
  start_time   time,
  end_time     time,
  -- The handoff's project-chip palette. A FIXED palette rather than a hashed
  -- hue, for the same reason the shift calendar uses one: hashing produces
  -- neighbouring greens eventually, and two things that look alike is the
  -- failure the colour exists to prevent.
  colour       text not null default '#1b2cc1',
  created_at   timestamptz not null default now(),

  constraint personal_event_title_not_blank
    check (btrim(title) <> ''),

  -- All day carries no times; a timed event carries both, and ends after it
  -- starts. One constraint rather than three so the two shapes cannot be
  -- half-written into one row.
  constraint personal_event_times_match_all_day
    check (
      (all_day and start_time is null and end_time is null)
      or (not all_day and start_time is not null and end_time is not null
          and end_time > start_time)
    ),

  constraint personal_event_colour_in_palette
    check (colour in ('#1b2cc1', '#0f6f7a', '#6c3fc5', '#1f7a3d',
                      '#8a5300', '#8e1d15', '#0a5ea8', '#7a3f8f'))
);

comment on table public.personal_event is
  'The admin''s own calendar. Read by nothing else: not the tier walk, not the '
  'overlap test, not the Arbetsdagbok. An event never makes anyone unavailable.';

-- The month grid asks for one month of one person's events, which is this.
create index personal_event_owner_date on public.personal_event (owner_id, event_date);
create index personal_event_date on public.personal_event (event_date);

create table public.personal_event_viewer (
  event_id    uuid not null references public.personal_event (id) on delete cascade,
  account_id  uuid not null references public.account (id) on delete cascade,
  primary key (event_id, account_id)
);

comment on table public.personal_event_viewer is
  'Who besides the owner sees an event. A list rather than a role, because '
  '"all arbetsledare" is wrong the day one leaves.';

-- "Which events can I see" is the read this table exists to answer.
create index personal_event_viewer_account on public.personal_event_viewer (account_id);

-- ---------------------------------------------------------------------------
-- The two helpers that break the policy cycle. SECURITY DEFINER, so each reads
-- its table as owner and the other table's policy is never consulted.
-- ---------------------------------------------------------------------------
create or replace function app.sees_personal_event(p_event uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.personal_event_viewer v
    where v.event_id = p_event and v.account_id = (select auth.uid())
  )
$$;

create or replace function app.owns_personal_event(p_event uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.personal_event e
    where e.id = p_event and e.owner_id = (select auth.uid())
  )
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.personal_event enable row level security;
alter table public.personal_event_viewer enable row level security;

-- Read: the owner, and anybody they named. An admin who did not create the
-- event is NOT on this list -- is_admin() is deliberately absent here. A
-- second owner reading the first one's week off is the thing "personlig"
-- rules out, and the admin's reach over shift data is not a reach over this.
create policy personal_event_select on public.personal_event
  for select
  using (
    owner_id = (select auth.uid())
    or app.sees_personal_event(id)
  );

-- Write: the owner, whoever they are. NOT gated on is_admin() -- a personal
-- calendar belongs to the person, and an owner who could not write their own
-- events would have none to share. `owner_id = auth.uid()` is in the WITH
-- CHECK as well as the USING, so nobody can create an event in somebody
-- else's name or hand one away by editing the column.
create policy personal_event_write on public.personal_event
  for all
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- A viewer row is readable by the person named on it -- otherwise the event's
-- own policy could never resolve for them -- and by the event's owner, who
-- needs to see who is on the list in order to edit it.
create policy personal_event_viewer_select on public.personal_event_viewer
  for select
  using (
    account_id = (select auth.uid())
    or app.owns_personal_event(event_id)
  );

-- Only the owner of the event decides who sees it. app.owns_personal_event()
-- is SECURITY DEFINER, which is what stops this policy and the one above it
-- from each needing the other's table (CLAUDE.md, gotcha 2).
create policy personal_event_viewer_write on public.personal_event_viewer
  for all
  using (app.owns_personal_event(event_id))
  with check (app.owns_personal_event(event_id));

-- ---------------------------------------------------------------------------
-- Grants. `authenticated` is one database role for every logged-in user, so
-- these say nothing about who may do what -- the policies above do. anon gets
-- nothing at all.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.personal_event to authenticated;
grant select, insert, update, delete on public.personal_event_viewer to authenticated;
revoke all on public.personal_event from anon;
revoke all on public.personal_event_viewer from anon;

grant execute on function app.sees_personal_event(uuid) to authenticated;
grant execute on function app.owns_personal_event(uuid) to authenticated;
