-- ============================================================================
-- KONTON AND PROFIL -- what the admin's Inställningar page needs.
--
-- Three things, and the third is the one with teeth:
--
--   1. public.profile -- personal details per ACCOUNT, not per worker, because
--      the founding admin has no worker row and still has a phone number.
--   2. account_directory gains the email, read from auth.users. That is the
--      only place an account's identity lives for someone with no worker row.
--   3. Pausing an account now means it: assignments on shifts that have not
--      started are released, pending offers are withdrawn, and the tier walk
--      stops considering the person at all.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A NEW RELEASE REASON
--
-- Added before anything that names it. The value cannot be USED in the same
-- transaction that adds it, which is fine: the only thing that names it is a
-- function body, and a body is text until it runs.
-- ---------------------------------------------------------------------------
alter type public.release_reason add value if not exists 'account_paused';

-- ---------------------------------------------------------------------------
-- 2. THE PROFILE
--
-- Keyed on the account. A worker record is about employment -- name, email,
-- lateness -- and can be soft-deleted; a person's bank details and next of kin
-- belong to whoever signs in, and the founding admin has no worker record at
-- all.
--
-- Everything is nullable on purpose. This form is filled in over time, from a
-- phone, by someone who may not have their org number to hand; a NOT NULL here
-- would mean the profile could not be saved until it was complete, which is
-- the opposite of "fills in what is missing".
-- ---------------------------------------------------------------------------
create table if not exists public.profile (
  account_id            uuid primary key references public.account(id) on delete cascade,

  -- Always shown.
  telefon               text,
  adress                text,
  postnummer            text,
  stad                  text,
  clearingnummer        text,
  kontonummer           text,
  anhorig_namn          text,
  anhorig_telefon       text,

  -- "Har du företag?" -- the toggle, and what it reveals.
  har_foretag           boolean not null default false,
  foretagsnamn          text,
  organisationsnummer   text,
  fakturaadress         text,
  foretag_postnummer    text,
  foretag_stad          text,
  lan                   text,
  bankgiro              text,
  momsreg               text,
  f_skatt               boolean not null default false,

  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.account(id)
);

alter table public.profile enable row level security;

-- SELF OR ADMIN, and deliberately NOT app.is_staff().
--
-- An arbetsledare is staff for everything to do with shifts, and nothing to do
-- with a colleague's bank account. Clearing and account numbers, a home
-- address and a next of kin's phone number are the most sensitive rows in this
-- database; the only people who see them are the person they describe and the
-- owner who has to pay them.
drop policy if exists profile_self_or_admin on public.profile;
create policy profile_self_or_admin on public.profile
  for all
  using (account_id = (select auth.uid()) or app.is_admin())
  with check (account_id = (select auth.uid()) or app.is_admin());

grant select, insert, update, delete on public.profile to authenticated;

create or replace function app.tg_profile_touch() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $fn$;

drop trigger if exists profile_touch on public.profile;
create trigger profile_touch
  before insert or update on public.profile
  for each row execute function app.tg_profile_touch();

-- ---------------------------------------------------------------------------
-- 3. THE DIRECTORY GAINS AN EMAIL
--
-- auth.users is not an exposed schema and never will be, so the email reaches
-- the client through this view or not at all. The view already runs as its
-- owner; the WHERE clause is the gate, and it is unchanged -- an admin sees
-- everyone, everyone else sees exactly themselves.
--
-- The name falls back to the auth metadata: a worker's name lives on their
-- worker record, but an account created by bootstrap-admin has no worker row
-- and would otherwise be a nameless line in the Konton list.
-- ---------------------------------------------------------------------------
create or replace view public.account_directory with (security_invoker = false) as
select
  a.id,
  a.role,
  a.active,
  w.id as worker_id,
  coalesce(w.name, u.raw_user_meta_data->>'name') as name,
  coalesce(w.email, u.email::text)                as email
from public.account a
left join public.worker w on w.account_id = a.id and w.deleted_at is null
left join auth.users u on u.id = a.id
where app.is_admin() or a.id = (select auth.uid());

-- ---------------------------------------------------------------------------
-- 4. A PAUSE THAT MEANS SOMETHING
--
-- "Pausing deactivates all future shifts -- the current shift is their last
-- until unpaused."
--
-- Not-yet-STARTED, not not-yet-ended: a shift someone is standing on right now
-- is a fact that still has to be confirmed, and taking it off them would erase
-- hours they actually worked. So the line is app.pass_start_at() > now(), and
-- a shift in progress is their last.
--
-- Each release goes through public.release_assignment(), which is what makes
-- the freed slot behave like every other vacancy: beyond five days it reopens
-- and walks the tiers, inside five days it reopens and waits for a human. The
-- alternative -- releasing quietly -- would leave a shift five weeks out short
-- one person with nothing anywhere saying so.
--
-- AFTER, not BEFORE: the cascade must see an account that is already paused,
-- or the tier walk it triggers could hand the slot straight back.
-- ---------------------------------------------------------------------------
create or replace function app.tg_account_pause() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  r record;
begin
  -- Any open offer to a paused person is a question they cannot answer.
  -- Released assignments take their own offers with them; this catches offers
  -- on passes they were never assigned to.
  update public.pass_offer o
  set state = 'withdrawn', responded_at = now()
  from public.pass p, public.worker w
  where o.pass_id = p.id
    and o.worker_id = w.id
    and w.account_id = new.id
    and o.state = 'offered'
    and p.deleted_at is null
    and app.pass_start_at(p.work_date, p.start_time) > now();

  for r in
    select t.id
    from public.tilldelning t
    join public.pass p   on p.id = t.pass_id and p.deleted_at is null
    join public.worker w on w.id = t.worker_id
    where w.account_id = new.id
      and t.released_at is null
      and app.pass_start_at(p.work_date, p.start_time) > now()
    order by p.work_date
  loop
    perform public.release_assignment(r.id, 'account_paused');
  end loop;

  return null;
end $fn$;

drop trigger if exists account_pause on public.account;
create trigger account_pause
  after update of active on public.account
  for each row
  when (old.active and not new.active)
  execute function app.tg_account_pause();

-- ---------------------------------------------------------------------------
-- 5. THE TIER WALK STOPS CONSIDERING A PAUSED PERSON
--
-- Releasing what they hold is only half of it. Without this, a pass created
-- tomorrow would offer itself to someone who is paused -- their förval is
-- still on the calendar, and nothing in the walk ever looked at whether the
-- account behind it could still be signed into.
--
-- Unchanged everywhere else, including the three fragments the negative
-- controls target.
-- ---------------------------------------------------------------------------
create or replace function app.fill_pass(p_pass uuid)
returns table (filled integer, offered integer)
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  r         record;
  v_batch   uuid;
  v_need    integer;
  v_worker  uuid;
  v_source  public.assignment_source;
begin
  select p.id, p.work_date as wd, p.headcount, p.batch_id
    into r
  from public.pass p
  where p.id = p_pass and p.deleted_at is null
  -- The same row lock the headcount guard takes. Held while slots are counted
  -- and filled, so a concurrent fill or accept cannot overshoot.
  for update;

  if r.id is null then
    filled := 0; offered := 0; return next; return;
  end if;

  v_batch := r.batch_id;

  select r.headcount - count(*) into v_need
  from public.tilldelning t
  where t.pass_id = r.id and t.released_at is null;

  filled := 0;
  offered := 0;

  for v_worker, v_source in
    with excluded as (
      -- INVARIANT 2, and the exclusion filter of Step 3: already holding an
      -- assignment that date makes a worker invisible for it.
      select t.worker_id from public.tilldelning t
      where t.work_date = r.wd and t.released_at is null
      union
      -- A worker taken off this pass is never re-offered it.
      select b.worker_id from public.pass_block b where b.pass_id = r.id
    ),
    available as (
      select
        f.worker_id,
        -- Hand-picking is scoped to the batch the pass was generated in. A pass
        -- created outside a batch simply has no hand-picks.
        coalesce((
          select true from public.pass_batch_handpick h
          where h.batch_id = v_batch and h.worker_id = f.worker_id
        ), false) as handpicked,
        (
          select count(*)
          from public.tilldelning t2
          join public.pass p2 on p2.id = t2.pass_id and p2.deleted_at is null
          where t2.worker_id = f.worker_id
            and t2.released_at is null
            -- A shift counts whether or not it has been confirmed.
            and t2.work_date >= app.week_start(r.wd)
            and t2.work_date <  app.week_start(r.wd) + 7
        ) as shifts_this_week,
        w.late_marks
      from public.forval f
      join public.worker w on w.id = f.worker_id and w.deleted_at is null
      -- A paused account is not a candidate. Pausing means "no future shifts",
      -- and a shift they are offered tomorrow is a future shift.
      join public.account a on a.id = w.account_id and a.active
      where f.work_date = r.wd
        and f.can_work                        -- the entry ticket
        and f.worker_id not in (select worker_id from excluded)
    ),
    ranked as (
      select
        worker_id,
        handpicked,
        -- Tier 1 is ordered the same way as Tier 2 (spec Section 8): fewest
        -- shifts that week first, each lateness mark pushing one position down,
        -- cumulatively and permanently. A position offset, not a sort key.
        row_number() over (partition by handpicked order by shifts_this_week, random())
          + late_marks as rank_in_tier
      from available
    )
    select
      worker_id,
      case when handpicked then 'handplockad' else 'forval' end::public.assignment_source
    from ranked
    order by handpicked desc, rank_in_tier, random()
    limit greatest(v_need, 0)
  loop
    begin
      insert into public.tilldelning (pass_id, worker_id, source, work_date)
      values (r.id, v_worker, v_source, r.wd);
      filled := filled + 1;
      v_need := v_need - 1;
    exception when unique_violation or check_violation then
      -- Someone took that date, or the pass filled, between ranking and insert.
      -- The guards are the authority; skip and carry on.
      null;
    end;
  end loop;

  -- TIER 3, only once the förval list is exhausted or empty.
  if v_need > 0 then
    insert into public.pass_offer (pass_id, worker_id)
    select r.id, w.id
    from public.worker w
    where w.deleted_at is null
      and exists (
        select 1 from public.account a where a.id = w.account_id and a.active
      )
      and not exists (
        select 1 from public.tilldelning t
        where t.worker_id = w.id and t.work_date = r.wd and t.released_at is null
      )
      and not exists (
        select 1 from public.pass_block b where b.pass_id = r.id and b.worker_id = w.id
      )
      -- Marking a day can't-work is an answer. Offering it back asks a question
      -- that has already been answered. (Spec Section 4, Tier 3.)
      and not exists (
        select 1 from public.forval f
        where f.worker_id = w.id and f.work_date = r.wd and not f.can_work
      )
    on conflict (pass_id, worker_id) do nothing;

    get diagnostics offered = row_count;
  end if;

  return next;
end $fn$;

-- ---------------------------------------------------------------------------
-- 6. ALLA PROJEKT, WITH THE HOURS ON IT
--
-- The admin's landing page is a list of projects with the hours booked against
-- each. Aggregating that in the browser would mean shipping every assignment
-- in the company to a phone to add them up.
--
-- INVARIANT 8 twice over: a deleted project is not a row here, and a deleted
-- worker's hours are filtered out of the sum rather than merely unjoined --
-- a left join alone would leave their confirmed_hours in the total with
-- nothing to attribute them to.
--
-- Confirmed hours only. A planned figure is what someone intends to work and
-- has no business being added to what was.
-- ---------------------------------------------------------------------------
create or replace view public.project_hours with (security_invoker = false) as
select
  pr.id           as project_id,
  pr.name,
  pr.site_address,
  pr.start_date,
  coalesce(sum(t.confirmed_hours) filter (where w.id is not null), 0)::numeric as hours
from public.project pr
left join public.pass p        on p.project_id = pr.id and p.deleted_at is null
left join public.tilldelning t on t.pass_id = p.id and t.released_at is null
left join public.worker w      on w.id = t.worker_id and w.deleted_at is null
where pr.deleted_at is null
  and app.leads_project(pr.id)
group by pr.id, pr.name, pr.site_address, pr.start_date;

grant select on public.project_hours to authenticated;
