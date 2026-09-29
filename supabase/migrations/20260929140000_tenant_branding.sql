-- ============================================================================
-- The company on its own Arbetsdagbok -- and no longer Bella's on everybody's.
--
-- WHAT WAS WRONG. The PDF's logo and its whole footer (postadress, telefon,
-- bankgiro, org.nr, momsreg.nr, F-skatt) were constants in the code: Bella
-- Service AB's. Every company's Arbetsdagbok carried Bella's identity. This
-- gives each tenancy its own, and the code stops carrying anybody's.
--
-- A TABLE OF ITS OWN, one row per tenancy, rather than columns on tenant. The
-- tenant row holds what the OPERATOR decides -- account_type, expires_at,
-- org_nr -- and a company admin who could update that row would need a trigger
-- guarding each of those. Here RLS can say it plainly: the admin edits their
-- company's branding and nothing else. org_nr and the name still come from
-- tenant; they are facts about the company, not presentation.
--
-- THE LOGO IS A PATH, not a URL: the bucket is private, and a URL would
-- expire. `<tenant_id>/logo.png` or `.jpg` -- the only two formats the PDF
-- can embed -- and the CHECK ties it to the row's own tenancy.
--
-- THE DOCUMENT REFUSES WITHOUT A SENDER. Address, contact and phone are
-- required to generate, enforced in app.tg_arbetsdagbok_guard beside the
-- bestallare block it already checks: invariant 6 in spirit, the document has
-- no empty cells about who sent it either. The logo is optional; the company
-- name prints in its place.
--
-- AND THE FACES. The avatars policies let ANY admin read, write, replace and
-- remove ANY account's picture -- app.is_admin() with no tenancy in it, so
-- one company's admin could reach another's. Invariant 12. They now test that
-- the account in the path belongs to the admin's own tenancy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------

create table public.tenant_branding (
  tenant_id    uuid primary key default app.current_tenant_id() references public.tenant(id),
  logo_path    text,
  address      text check (btrim(address) <> '' and length(address) <= 200),
  contact_name text check (btrim(contact_name) <> '' and length(contact_name) <= 120),
  phone        text check (btrim(phone) <> '' and length(phone) <= 40),
  bankgiro     text check (btrim(bankgiro) <> '' and length(bankgiro) <= 20),
  momsreg_nr   text check (btrim(momsreg_nr) <> '' and length(momsreg_nr) <= 30),
  f_skatt      boolean not null default false,
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid(),

  constraint tenant_branding_logo_is_its_own
    check (logo_path is null
           or logo_path in (tenant_id::text || '/logo.png', tenant_id::text || '/logo.jpg'))
);

alter table public.tenant_branding enable row level security;

revoke all on public.tenant_branding from anon, authenticated;
grant select, insert, update on public.tenant_branding to authenticated;

-- Staff read it: the admin to edit it and to generate the document. An
-- arbetare has no use for it.
create policy tenant_branding_select on public.tenant_branding
  for select to authenticated
  using (app.in_tenant(tenant_id) and app.is_staff());

create policy tenant_branding_insert on public.tenant_branding
  for insert to authenticated
  with check (app.in_tenant(tenant_id) and app.is_admin());

create policy tenant_branding_update on public.tenant_branding
  for update to authenticated
  using (app.in_tenant(tenant_id) and app.is_admin())
  with check (app.in_tenant(tenant_id) and app.is_admin());

-- Who changed it last, and when -- written here, never trusted from a client.
create or replace function app.tg_tenant_branding_touch() returns trigger
  language plpgsql security definer
  set search_path = ''
as $fn$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $fn$;

create trigger tenant_branding_touch
  before insert or update on public.tenant_branding
  for each row execute function app.tg_tenant_branding_touch();

revoke all on function app.tg_tenant_branding_touch() from public;
grant execute on function app.tg_tenant_branding_touch() to authenticated;

-- ---------------------------------------------------------------------------
-- The logo's bucket. Private; the first folder is the tenancy.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists branding_read on storage.objects;
create policy branding_read on storage.objects for select to authenticated
using (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = app.current_tenant_id()::text
  and app.is_staff()
);

drop policy if exists branding_write on storage.objects;
create policy branding_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = app.current_tenant_id()::text
  and storage.filename(name) in ('logo.png', 'logo.jpg')
  and app.is_admin()
);

drop policy if exists branding_replace on storage.objects;
create policy branding_replace on storage.objects for update to authenticated
using (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = app.current_tenant_id()::text
  and app.is_admin()
)
with check (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = app.current_tenant_id()::text
  and storage.filename(name) in ('logo.png', 'logo.jpg')
  and app.is_admin()
);

drop policy if exists branding_remove on storage.objects;
create policy branding_remove on storage.objects for delete to authenticated
using (
  bucket_id = 'branding'
  and (storage.foldername(name))[1] = app.current_tenant_id()::text
  and app.is_admin()
);

-- ---------------------------------------------------------------------------
-- The faces, kept inside their company.
-- ---------------------------------------------------------------------------

-- Whether the account a storage path names belongs to the caller's tenancy.
-- A function rather than a subquery in the policy: policy expressions run with
-- the caller's privileges, and account's own policy is not what should decide
-- this.
create or replace function app.path_account_in_my_tenant(p_folder text) returns boolean
  language sql stable security definer
  set search_path = ''
as $fn$
  select coalesce(
    (select app.in_tenant(a.tenant_id) from public.account a where a.id::text = p_folder),
    false)
$fn$;

revoke all on function app.path_account_in_my_tenant(text) from public;
grant execute on function app.path_account_in_my_tenant(text) to authenticated;

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
using (
  bucket_id = 'avatars'
  and ((storage.foldername(name))[1] = (select auth.uid())::text
       or (app.is_admin() and app.path_account_in_my_tenant((storage.foldername(name))[1])))
);

drop policy if exists avatars_write on storage.objects;
create policy avatars_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and ((storage.foldername(name))[1] = (select auth.uid())::text
       or (app.is_admin() and app.path_account_in_my_tenant((storage.foldername(name))[1])))
);

drop policy if exists avatars_replace on storage.objects;
create policy avatars_replace on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and ((storage.foldername(name))[1] = (select auth.uid())::text
       or (app.is_admin() and app.path_account_in_my_tenant((storage.foldername(name))[1])))
)
with check (
  bucket_id = 'avatars'
  and ((storage.foldername(name))[1] = (select auth.uid())::text
       or (app.is_admin() and app.path_account_in_my_tenant((storage.foldername(name))[1])))
);

drop policy if exists avatars_remove on storage.objects;
create policy avatars_remove on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and ((storage.foldername(name))[1] = (select auth.uid())::text
       or (app.is_admin() and app.path_account_in_my_tenant((storage.foldername(name))[1])))
);

-- ---------------------------------------------------------------------------
-- The document refuses without a sender.
-- The function is the live one, unchanged, with one block added after the
-- bestallare check.
-- ---------------------------------------------------------------------------

create or replace function app.tg_arbetsdagbok_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
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

  -- The SENDER, as the customer is checked above: the footer says who issued
  -- the document, and a blank there is as empty a cell as any other. The
  -- CHECKs on tenant_branding already refuse whitespace, so present is filled.
  if not exists (
    select 1 from public.tenant_branding b
     where b.tenant_id = v_project.tenant_id
       and b.address is not null and b.contact_name is not null and b.phone is not null
  ) then
    raise exception 'the company''s own details are incomplete (address, contact, phone); the document cannot say who issued it'
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
end $function$;

-- ---------------------------------------------------------------------------
-- Bella Service AB keeps exactly the footer it has today. The values were
-- constants in src/lib/doc/arbetsdagbok.ts; they move here, and the code stops
-- carrying them. The logo goes to branding/<bella>/logo.png by a one-off
-- upload after this migration, which then sets logo_path.
-- ---------------------------------------------------------------------------

insert into public.tenant_branding
  (tenant_id, address, contact_name, phone, bankgiro, momsreg_nr, f_skatt)
select t.id, 'Söderto 3276, 242 93 Hörby', 'Antoine', '073-398 78 68',
       '443-4551', 'CEFFSTA99339001', true
  from public.tenant t
 where t.org_nr = '556788-2369'
on conflict (tenant_id) do nothing;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260929140000', 'tenant_branding', null)
on conflict (version) do nothing;
