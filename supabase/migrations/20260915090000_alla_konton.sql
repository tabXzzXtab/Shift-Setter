-- ============================================================================
-- ALLA KONTON
--
-- The Konton list stops being a wall. Three things follow, and the first two
-- are not cosmetic.
--
-- 1. AN ACCOUNT CAN BE REMOVED.
--
-- Until now it could only be paused, and the screen said so in a comment: "an
-- account is paused, never removed, so the red square that would sit at the
-- end has nothing to do." The handoff always drew that square. The reason it
-- had nothing to do is that the database will not let an account go:
--
--     worker.account_id     -> account(id)   ON DELETE RESTRICT
--     tilldelning.worker_id -> worker(id)    ON DELETE RESTRICT
--
-- and a dozen audit columns -- pass.created_by, project_day.confirmed_by,
-- arbetsdagbok.generated_by, clock_edit.edited_by -- point at account(id) with
-- no action at all. That is not an oversight to route around. Invariant 3 says
-- an edit survives "visible and attributed to whoever changed it", and a
-- document that names who confirmed a day cannot name a row that has been
-- erased.
--
-- So removal is TWO acts, and the FOREIGN KEYS decide which one happens rather
-- than this function guessing:
--
--   * An account nothing points at -- created by mistake, never worked, never
--     confirmed, never created a project -- is genuinely deleted. Its worker
--     row goes with it, and foerval, offers and blocks cascade away behind it.
--     Nothing is lost because nothing happened.
--
--   * An account with history is shut down instead: worker.deleted_at is set
--     (invariant 8 -- their shifts now count nowhere, in every read) and the
--     account is marked removed and inactive. The row survives so every
--     Arbetsdagbok that names them keeps naming them.
--
-- Attempting the delete and catching foreign_key_violation is deliberate. An
-- enumeration of the twelve referencing columns would be correct today and
-- wrong the first time a thirteenth is added; the constraint is the authority,
-- so the constraint is what gets asked.
--
-- INVARIANT 11 needs nothing new. app.tg_last_admin_guard() is already
-- `before update or delete on public.account` and already handles TG_OP =
-- 'DELETE'; both paths here go through it, so the last active admin is refused
-- whether they have history or not. Writing that rule a second time in this
-- function is how two rules drift apart.
--
-- Nor does the removal need to be taught to every roster. Every read that
-- ranks, offers or picks a person already carries `and a.active` --
-- app.fill_pass's two tiers, leader_replacement_options, arbetsledare_roster,
-- the replacement walk -- and app.current_role() itself ends in `and a.active`,
-- so a removed account resolves to NULL and gotcha 3 turns every helper false.
-- worker_roster filters w.deleted_at instead, which the soft path also sets.
-- Removal implies pause, and pause was already understood everywhere.
--
-- 2. A REMOVED ACCOUNT MUST LEAVE THE ADMIN'S SIGHT.
--
-- account.deleted_at goes in the VIEW, not in the policy. A SELECT policy
-- carrying `deleted_at is null` makes the row fail its own policy the instant
-- the column is set -- gotcha 1, the wall public.delete_pass() was written
-- against. account_directory is already the only way the client reads an
-- account by name, and it already runs as its owner with its own WHERE as the
-- gate, so the filter belongs there.
--
-- 3. EVERY ACCOUNT CAN CARRY A FACE.
--
-- On profile, not on worker. worker.avatar_url has existed since the initial
-- schema and has never been written, and it never could serve this: an account
-- created by bootstrap-admin has no worker row, and the owner is exactly who
-- the new list puts at the top. profile is keyed on the account for that same
-- reason -- "the founding admin has no worker record and still has a phone
-- number and a bank account."
--
-- avatar_path, not avatar_url. It holds a storage object path, and a column
-- named _url that cannot be put in a src= is a lie that costs somebody an
-- hour. The bucket is private, so the browser signs the paths it reads.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE TWO COLUMNS
-- ---------------------------------------------------------------------------
alter table public.account add column if not exists deleted_at timestamptz;
alter table public.profile add column if not exists avatar_path text;

comment on column public.account.deleted_at is
  'Set by public.delete_account() when the account has history and cannot be erased. Filtered in account_directory, never in a policy -- gotcha 1.';

comment on column public.profile.avatar_path is
  'Object path inside the private "avatars" bucket, not a URL. The browser signs it to read it.';

-- ---------------------------------------------------------------------------
-- 2. THE DIRECTORY CARRIES THE FACE, AND DROPS THE REMOVED
--
-- security_invoker = false is unchanged, so the join to profile reads past its
-- self-or-admin policy -- and adds nothing, because the view's own WHERE is
-- still "admin sees everyone, everyone else sees exactly themselves". The
-- columns that were there keep their order; avatar_path is appended, so every
-- existing caller is untouched.
-- ---------------------------------------------------------------------------
create or replace view public.account_directory with (security_invoker = false) as
select
  a.id,
  a.role,
  a.active,
  w.id as worker_id,
  coalesce(w.name, u.raw_user_meta_data->>'name') as name,
  coalesce(w.email, u.email::text)                as email,
  p.avatar_path
from public.account a
left join public.worker w on w.account_id = a.id and w.deleted_at is null
left join auth.users u on u.id = a.id
left join public.profile p on p.account_id = a.id
where a.deleted_at is null
  and (app.is_admin() or a.id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. THE BUCKET
--
-- Private. A public bucket would make every face readable by anyone who can
-- guess an account id, and an account id is in the URL of the page that edits
-- it. 2 MB is the ceiling on what the browser may hand over AFTER it has
-- already downscaled a phone photo to 512px; the limit is here so that a
-- client which skips the downscale is refused by the database rather than
-- filling the bucket with 4 MB camera originals.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- The path is "<account_id>/<random>.webp", so the first folder segment is the
-- owner. Keying the policy on the PATH rather than on storage.objects.owner is
-- what lets the admin replace somebody else's picture from the profile screen
-- they can already edit -- owner would record the admin, and the next read
-- would belong to the wrong person.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
using (
  bucket_id = 'avatars'
  and (app.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
);

drop policy if exists avatars_write on storage.objects;
create policy avatars_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (app.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
);

drop policy if exists avatars_replace on storage.objects;
create policy avatars_replace on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (app.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
)
with check (
  bucket_id = 'avatars'
  and (app.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
);

drop policy if exists avatars_remove on storage.objects;
create policy avatars_remove on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (app.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
);

-- ---------------------------------------------------------------------------
-- 4. REMOVAL
--
-- Returns which of the two acts happened, because the dialog that asked has to
-- say which one it was. 'raderat' -- the row is gone. 'avstangt' -- the login
-- is dead and the history stands.
--
-- SECURITY DEFINER for the same reason public.delete_pass() is: the soft path
-- writes worker.deleted_at, and worker_self_profile_update would let the person
-- being removed do that to themselves, which is not the same act at all. The
-- admin test is in here, once.
-- ---------------------------------------------------------------------------
create or replace function public.delete_account(p_account uuid) returns text
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_deleted timestamptz;
  v_mode    text;
begin
  -- Not app.is_staff(): removing somebody is an owner's act. An arbetsledare
  -- runs days, not the payroll.
  if not app.is_admin() then
    raise exception 'only an admin removes an account'
      using errcode = 'insufficient_privilege';
  end if;

  if p_account = (select auth.uid()) then
    raise exception 'an account cannot remove itself'
      using errcode = 'check_violation';
  end if;

  select a.deleted_at into v_deleted from public.account a where a.id = p_account;

  if not found then
    raise exception 'no such account' using errcode = 'check_violation';
  end if;

  if v_deleted is not null then
    raise exception 'account is already removed' using errcode = 'check_violation';
  end if;

  -- Ask the constraints. Both statements sit in one subtransaction, so a
  -- RESTRICT anywhere leaves the worker row exactly as it was.
  --
  -- app.tg_last_admin_guard() fires BEFORE DELETE on account and raises
  -- insufficient_privilege, which is not foreign_key_violation and therefore
  -- travels straight out of here. Invariant 11 refuses the last active admin
  -- on this path without being asked to.
  begin
    delete from public.worker  where account_id = p_account;
    delete from public.account where id = p_account;
    v_mode := 'raderat';
  exception when foreign_key_violation then
    v_mode := 'avstangt';
  end;

  if v_mode = 'avstangt' then
    -- INVARIANT 8. Their shifts count nowhere from here on, in every read.
    update public.worker
       set deleted_at = now()
     where account_id = p_account and deleted_at is null;

    -- active = false is what does the work: it fires app.tg_account_pause(),
    -- which releases every shift that has not started and withdraws every open
    -- offer, and it is what app.current_role() tests, so the account resolves
    -- to NULL from the next request onwards. The same UPDATE goes through
    -- app.tg_last_admin_guard(), so this path refuses the last admin too.
    update public.account
       set active = false, deleted_at = now()
     where id = p_account;
  end if;

  return v_mode;
end $fn$;

revoke all on function public.delete_account(uuid) from public;
grant execute on function public.delete_account(uuid) to authenticated;

-- A new function in public, and the app schema re-granted the way every
-- migration that adds one does it.
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
