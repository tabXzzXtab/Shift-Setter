-- Lunch/Rast preset values per bolag.
-- Three configurable break durations (minutes) for shift hour calculation.
-- Defaults: 15, 30, 45 minutes.
--
-- NOTE: network egress blocks port 5432 from the CI environment that wrote
-- this migration. Apply it manually via the Supabase SQL editor at
-- https://supabase.com/dashboard/project/ahujmzahjuvnlzbyyycc/editor
--
-- Until this migration is applied the app falls back to localStorage,
-- keyed "lunch_presets:<tenant_id>", with the same defaults.

create table if not exists public.bolag_settings (
  tenant_id   uuid        not null references public.tenant(id),
  preset_1    smallint    not null default 15 check (preset_1 between 1 and 240),
  preset_2    smallint    not null default 30 check (preset_2 between 1 and 240),
  preset_3    smallint    not null default 45 check (preset_3 between 1 and 240),
  updated_at  timestamptz not null default now(),
  constraint bolag_settings_pkey primary key (tenant_id)
);

alter table public.bolag_settings enable row level security;

-- Admin can read and write; all staff can read (needed when creating shifts).
create policy "admin kan hantera inställningar"
  on public.bolag_settings
  for all
  using  (app.in_tenant(tenant_id) and app.is_admin())
  with check (app.in_tenant(tenant_id) and app.is_admin());

create policy "personal kan läsa inställningar"
  on public.bolag_settings
  for select
  using (app.in_tenant(tenant_id) and app.is_staff());
