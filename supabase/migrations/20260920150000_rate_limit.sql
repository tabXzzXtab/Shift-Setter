-- ============================================================================
-- A DURABLE ATTEMPT COUNTER, because the one in the Edge Function was not.
--
-- verify-pin shipped with a rate limiter held in a Map in isolate memory. It
-- returns 429 on the sixth attempt when run locally under Deno; on the
-- deployed function it never fires at all. Measured, not assumed: twelve wrong
-- codes from one caller inside one minute were all answered 200. That memory
-- does not survive between requests on Supabase's edge, so every attempt
-- arrives with an empty window. A five-digit code behind it is 100k guesses at
-- whatever rate somebody cares to send.
--
-- The database is the only shared store this architecture has -- no cron, no
-- server, no Redis -- so the count comes here.
--
-- TWO CEILINGS, AND BOTH OF THEM BITE.
--
--   per caller   5 attempts per minute
--   everybody   40 attempts per minute
--
-- THE FIRST x-forwarded-for ENTRY IS THE PLATFORM'S, NOT THE CALLER'S, and
-- that is the whole reason the per-caller half works. I asserted the opposite
-- while designing this -- that the header is caller-settable, so rotating it
-- would defeat any per-IP limit however it was stored -- and the deployed
-- function disproves it. Forty-seven requests carrying forty-seven different
-- x-forwarded-for values all landed in ONE bucket, keyed on the real client
-- address; not one 'unknown' row was written. Supabase's edge PREPENDS the
-- true address and whatever the caller sent is appended behind it.
--
-- So `split(',')[0]` is load-bearing and not a tidy-up. Taking the LAST entry,
-- or trusting a platform that appended instead of prepending, would hand the
-- bucket key back to the caller and make the per-IP ceiling decorative. If
-- this ever moves off Supabase's edge, re-measure before trusting it again.
--
-- The global ceiling is the one that does not depend on that behaviour at all.
-- Its price is stated rather than hidden: WHILE AN ATTACK IS RUNNING A REAL
-- SALESPERSON IS TURNED AWAY TOO. Forty a minute is set well above what
-- onboarding a customer takes and well below what exhausting a five-digit code
-- needs.
--
-- ONE CONSEQUENCE OF KEYING ON THE REAL ADDRESS: an office behind one NAT is
-- one caller. Five a minute is the whole office, not five each.
--
-- NO tenant_id, DELIBERATELY. M2a put a tenant clause on all 34 policies, so
-- the absence here reads as an oversight unless it is written down: this table
-- counts requests from people who are not logged in and have no account, at a
-- gate that exists BEFORE a tenancy is chosen. There is no tenant to derive
-- one from and nobody to attribute a row to. It is operator infrastructure,
-- not customer data. Do not "fix" it by adding the column.
--
-- FIXED WINDOWS, not sliding. window_start is the minute a request landed in,
-- so the count resets on the minute rather than trailing the last sixty
-- seconds. The known cost of a fixed window is a burst across the boundary --
-- up to 2N in the two seconds spanning it. At 5 and 40 that is 10 and 80,
-- which changes nothing about either ceiling's purpose, and it buys a counter
-- that is one row and one upsert instead of a list of timestamps per caller.
-- ============================================================================

create table app.rate_limit (
  ip           text        not null,
  window_start timestamptz not null,
  attempts     int         not null default 0,
  primary key (ip, window_start)
);

-- No grants and no policies, the same wall app.acting_tenant stands behind:
-- `app` is not an exposed schema, `authenticated` holds no privilege on tables
-- in it, and the only writer is the SECURITY DEFINER function below. RLS on as
-- a second wall rather than a first one.
alter table app.rate_limit enable row level security;

comment on table app.rate_limit is
  'Attempts per caller per minute for the onboarding PIN gate. No tenant_id by '
  'design: the callers are anonymous and pre-tenancy. Written only by '
  'public.note_pin_attempt().';

-- The global bucket rides in the same table under a key that cannot collide
-- with a caller, because '*' is not an address anybody can send. A second
-- table for one row, or a nullable column to tell the two apart, would both be
-- more moving parts than a reserved key.
comment on column app.rate_limit.ip is
  'The caller''s x-forwarded-for value, or ''*'' for the global bucket.';

-- ---------------------------------------------------------------------------
-- Count an attempt, and say whether it is allowed.
--
-- ONE CALL DOES BOTH, and that is not a convenience. Read-then-write from the
-- function would race: two requests arriving together would each read four and
-- each decide they were the fifth. The upsert is atomic per row, so the count
-- a caller gets back is the count their own attempt produced.
--
-- THE ATTEMPT IS COUNTED BEFORE IT IS JUDGED, including when it is refused.
-- A refused attempt is still an attempt, and a limiter that stopped counting
-- once it started refusing would let a caller hold exactly at the ceiling
-- forever. The fixed window is what releases them a minute later.
--
-- Returns 'ok', 'ip' or 'global' -- which ceiling stopped it, for the log.
-- The caller is told the same thing either way; see verify-pin.
-- ---------------------------------------------------------------------------
create or replace function public.note_pin_attempt(p_ip text)
  returns text
  language plpgsql volatile security definer
  set search_path = ''
as $$
declare
  w         timestamptz := date_trunc('minute', now());
  n_global  int;
  n_ip      int;
begin
  -- An absent or blank header is one bucket, not a free pass. Everyone who
  -- arrives without an address shares a counter, which is the conservative
  -- reading of "we do not know who this is".
  p_ip := coalesce(nullif(btrim(p_ip), ''), 'unknown');

  -- Never let a caller's header address the global bucket by sending '*'.
  if p_ip = '*' then
    p_ip := 'unknown';
  end if;

  insert into app.rate_limit as r (ip, window_start, attempts)
  values ('*', w, 1)
  on conflict (ip, window_start) do update set attempts = r.attempts + 1
  returning r.attempts into n_global;

  insert into app.rate_limit as r (ip, window_start, attempts)
  values (p_ip, w, 1)
  on conflict (ip, window_start) do update set attempts = r.attempts + 1
  returning r.attempts into n_ip;

  -- Once a minute, when the global bucket is first written for a new window,
  -- sweep what the previous windows left. There is no cron in this
  -- architecture, so the only place this can happen is in the path itself --
  -- and pinning it to the one row that is written exactly once per minute
  -- keeps it off the other forty calls.
  if n_global = 1 then
    delete from app.rate_limit where window_start < w - interval '10 minutes';
  end if;

  -- Global first: when both have tripped, the systemic condition is the one
  -- worth recording, and it is the one that explains why an innocent caller
  -- was refused.
  if n_global > 40 then
    return 'global';
  elsif n_ip > 5 then
    return 'ip';
  end if;

  return 'ok';
end;
$$;

-- POSTGRES GRANTS EXECUTE TO PUBLIC BY DEFAULT, so the revoke is the load-
-- bearing line here and not boilerplate. Without it any logged-in user -- or
-- anyone holding the anon key, which ships in the bundle -- could call this
-- in a loop and pin the global ceiling, turning a brute-force guard into a
-- way to shut onboarding off for everybody.
--
-- Only the Edge Function reaches it, and only through the service-role key.
revoke all on function public.note_pin_attempt(text) from public;
revoke all on function public.note_pin_attempt(text) from anon, authenticated;
grant execute on function public.note_pin_attempt(text) to service_role;

comment on function public.note_pin_attempt(text) is
  'Counts one onboarding PIN attempt and returns ok|ip|global. service_role '
  'only -- callable by the verify-pin Edge Function and nothing else.';
