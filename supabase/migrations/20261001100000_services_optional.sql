-- Tjänster is no longer asked for when a project is created.
--
-- The user's decision (2026-10-01): a project's history is what the leaders
-- write in "Vad vi gjorde idag" on Bekräfta dagen, so a services line typed
-- once at creation is not needed there. Skapa ett projekt stops asking for it;
-- Redigera projekt still shows it and still edits it.
--
-- NOT A FIELD THE DOCUMENT NEEDS. Nothing that builds the Arbetsdagbok reads
-- project.services, so invariants 6 and 7 do not reach it.
--
-- ONLY THE NOT NULL GOES. project_services_check stays: "btrim(services) <> ''"
-- is NULL -- and so passes -- when services is NULL, and still refuses a
-- services line of only spaces. Absent is allowed; blank is not.

alter table public.project alter column services drop not null;

comment on column public.project.services is
  'Optional since 2026-10-01: not asked for at creation, editable on Redigera projekt. '
  'Never blank (project_services_check); NULL when nobody has written one.';

-- The CLI ledger, so `db push` would see this as applied (CLAUDE.md).
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261001100000', 'services_optional', null)
on conflict (version) do nothing;
