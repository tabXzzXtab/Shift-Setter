-- ============================================================================
-- PUSH TOKEN -- which device to wake, and whose it is right now.
--
-- The frontend half only. Nothing here sends anything: sending needs the APNs
-- and FCM credentials, which are server-side secrets, which on a static export
-- means a Supabase Edge Function (CLAUDE.md). This table is what that function
-- will read; it is written by the app and read by nobody else.
--
-- THE TOKEN IS THE KEY, AND THAT IS THE WHOLE DESIGN DECISION.
--
-- A push token identifies a DEVICE, not a person. Site phones get shared --
-- one handset in a van, whoever is driving it signs in. Key the row on
-- (account_id, token) and both accounts keep a row for the same handset, so
-- the phone in Karl's hand goes on buzzing with Arvid's shifts, his hours and
-- his days. That is not a schema preference, it is somebody reading another
-- person's work on a screen they are holding.
--
-- So: primary key on the token, one row per device, and signing in MOVES it.
-- The last person to log in owns the handset, which is the only claim about it
-- that is true at the moment it is made. A person with two phones has two
-- rows, which is correct -- they want both to ring.
--
-- SIGNING OUT GIVES THE DEVICE BACK. forget_push_token() drops the row, so a
-- handed-back phone stops receiving before the next person touches it rather
-- than at some later login. It is scoped to the caller's own row, which is
-- what makes the shared-phone sequence come out right: A signs in (row is
-- A's), B signs in on the same handset (row moves to B), A signs out somewhere
-- else and deletes NOTHING, because the row is no longer theirs.
--
-- NOBODY READS THIS FROM A BROWSER. There is no select policy and no table
-- grant: every write goes through the two SECURITY DEFINER functions below,
-- and the only reader is the Edge Function, which uses the service role and
-- bypasses RLS. A device token is a routing address -- handing it to a logged
-- in user buys nothing and leaks a way to address somebody's phone.
-- ============================================================================

create table public.push_token (
  -- APNs and FCM both hand back an opaque string. Long, and not a uuid.
  token       text primary key,
  account_id  uuid not null references public.account (id) on delete cascade,

  -- Which service to send through. The two Capacitor can actually register
  -- on; @capacitor/push-notifications has no web implementation, so a browser
  -- never reaches this table and 'web' would be a value nothing can write.
  platform    text not null,
  updated_at  timestamptz not null default now(),

  constraint push_token_platform_known check (platform in ('ios', 'android')),
  constraint push_token_not_blank check (btrim(token) <> '')
);

comment on table public.push_token is
  'One row per DEVICE, keyed on the token. Signing in moves the row to the '
  'signer, so a shared site phone never wakes for the person who had it last.';

-- "Which devices do I wake for this account" is the read the sender does.
create index push_token_account on public.push_token (account_id);

-- ---------------------------------------------------------------------------
-- Registering. SECURITY DEFINER because the table has no grants at all: the
-- app cannot touch it except through here, and here it can only ever write
-- itself as the owner.
--
-- account_id is auth.uid() and is NOT a parameter. A caller who could name the
-- account could point somebody else's notifications at their own handset,
-- which is the same leak the shared-phone case is about, arriving by a
-- different road.
-- ---------------------------------------------------------------------------
create or replace function public.register_push_token(p_token text, p_platform text)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_account uuid := (select auth.uid());
begin
  if v_account is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- A paused or missing account has no role, and a three-valued result must
  -- never be a permission (CLAUDE.md, gotcha 3).
  if not coalesce(app.current_role() is not null, false) then
    raise exception 'this account is not active' using errcode = 'insufficient_privilege';
  end if;

  insert into public.push_token (token, account_id, platform, updated_at)
  values (btrim(p_token), v_account, p_platform, now())
  on conflict (token) do update
    -- THE MOVE. Whoever signed in last owns the handset.
    set account_id = excluded.account_id,
        platform   = excluded.platform,
        updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Handing the device back. Scoped to the caller's own row on purpose -- see
-- the header: signing out somewhere else must not silence a handset that has
-- since been claimed by the person now holding it.
-- ---------------------------------------------------------------------------
create or replace function public.forget_push_token(p_token text)
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  delete from public.push_token
  where token = btrim(p_token)
    and account_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- RLS on, and deliberately no policy. With RLS enabled and nothing permitting
-- anything, `authenticated` reads and writes nothing directly; the two
-- functions above run as owner and are the only way in. The service role
-- bypasses RLS entirely, which is how the Edge Function will read it.
-- ---------------------------------------------------------------------------
alter table public.push_token enable row level security;

revoke all on public.push_token from authenticated;
revoke all on public.push_token from anon;

-- FROM PUBLIC, NOT FROM anon. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and anon is a member of PUBLIC -- so revoking from anon
-- alone leaves the function callable by exactly the role it was meant to keep
-- out, and every test of it passes because the guard inside still refuses a
-- caller with no auth.uid(). Defence in depth is not the point here: these are
-- SECURITY DEFINER and run as the owner, so the grant is the outer door.
revoke all on function public.register_push_token(text, text) from public;
revoke all on function public.forget_push_token(text) from public;

grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.forget_push_token(text) to authenticated;
