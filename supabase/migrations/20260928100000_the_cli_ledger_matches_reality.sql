-- ============================================================================
-- THE CLI'S LEDGER MATCHES REALITY.
--
-- supabase_migrations.schema_migrations held SIX rows against 52
-- migration files. Tracking stopped on 4 September; everything since has been
-- applied by hand through `npm run db:sql -- --file`, which is this project's
-- actual route and does not write to that table.
--
-- NOTHING WAS BROKEN BY THAT, and this fixes no live behaviour. No workflow,
-- no npm script and no part of the app reads the ledger -- the real safety net
-- is schema.snapshot.txt and db:check, and that has been accurate throughout.
--
-- WHAT IT WAS INSTEAD IS A LOADED TRAP, and the person most likely to spring it
-- is a future session reaching for the standard Supabase workflow because
-- nothing told them this project does not use it. `supabase db push` would have
-- read six applied versions, called the other 46 unapplied, and replayed them
-- onto production. That is not a no-op:
--
--   * every `create or replace function` would succeed SILENTLY, reverting the
--     live definition to whatever that file said -- undoing the later fixes to
--     fill_pass, flag_day and tg_last_admin_guard;
--   * tenant_structure.sql INSERTS both tenant rows with pinned uuids, which
--     now collides with tenant_org_nr_key;
--   * the rest would fail loudly, part-way, with the first two already done.
--
-- So the ledger is filled in to say what is true: all of it is applied. After
-- this, `db push` is the no-op it should always have been.
--
-- STATEMENTS IS LEFT NULL, which is what `supabase migration repair --status
-- applied` writes. The CLI decides what to apply from the VERSION column; the
-- statements are a record of what it ran, and it did not run these -- claiming
-- otherwise would be inventing history rather than recording it.
--
-- This migration records ITSELF too, so the ledger is complete the moment it
-- finishes rather than one row short forever.
--
-- IT IS NOT A SCHEMA CHANGE. No object in app or public moves, so db:check and
-- schema.snapshot.txt are untouched by it -- schema-check only reads those two
-- schemas.
-- ============================================================================

insert into supabase_migrations.schema_migrations (version, name, statements)
values
  ('20260902120000', 'initial_schema', null),
  ('20260903090000', 'forval_tiers_and_offers', null),
  ('20260903120000', 'vacancy_cascade', null),
  ('20260903180000', 'snabb_pass', null),
  ('20260903210000', 'snabb_pass_admin_only', null),
  ('20260904090000', 'hours_visible_once_filed', null),
  ('20260904150000', 'bristsurvey', null),
  ('20260904180000', 'stage_two_review', null),
  ('20260904190000', 'konton_och_profil', null),
  ('20260905090000', 'open_pass', null),
  ('20260905120000', 'avboka_pass_worker', null),
  ('20260905150000', 'ledare_source', null),
  ('20260905150100', 'arbetsledare_placeras', null),
  ('20260905180000', 'survey_reads_the_envelope', null),
  ('20260905180100', 'unpause_replaces_the_leader', null),
  ('20260905200000', 'flagged_day_labels', null),
  ('20260905200100', 'flagged_days', null),
  ('20260905220000', 'byta_plats', null),
  ('20260905233000', 'confirmation_scope_is_the_day', null),
  ('20260906090000', 'the_replacement_comes_back', null),
  ('20260906120000', 'a_cancelled_day_says_so', null),
  ('20260907090000', 'handplocka_ar_for_arbetare', null),
  ('20260907120000', 'the_late_mark_the_confirmation_writes', null),
  ('20260908090000', 'invariant_2_is_about_overlap', null),
  ('20260908120000', 'redigera_och_ta_bort_projekt', null),
  ('20260908160000', 'stang_pagaende_pass', null),
  ('20260909140000', 'personlig_kalender', null),
  ('20260910093000', 'ledarens_tider_ar_ledarens_rad', null),
  ('20260912090000', 'arbetsledare_skapar_projekt', null),
  ('20260914090000', 'snabb_ar_en_fjarde_vag', null),
  ('20260914090100', 'snabb_pass_bekraftar_sin_egen_dag', null),
  ('20260915090000', 'alla_konton', null),
  ('20260918090000', 'push_token', null),
  ('20260918120000', 'tenant_structure', null),
  ('20260918140000', 'tenant_id_defaults', null),
  ('20260918170000', 'ett_nej_gar_att_angra', null),
  ('20260919090000', 'tenant_from_parent', null),
  ('20260919140000', 'fill_pass_is_tenant_aware', null),
  ('20260919160000', 'push_token_tenant', null),
  ('20260919180000', 'policies_carry_the_tenant', null),
  ('20260919200000', 'acting_tenant', null),
  ('20260920090000', 'acting_tenant_read', null),
  ('20260920110000', 'pg_net', null),
  ('20260920120000', 'rpcs_check_the_tenant', null),
  ('20260920140000', 'day_admin_confirmed_kind', null),
  ('20260920150000', 'rate_limit', null),
  ('20260920160000', 'views_carry_the_tenant', null),
  ('20260920170000', 'push_dispatch', null),
  ('20260920180000', 'the_other_views_carry_the_tenant', null),
  ('20260923093000', 'the_last_admin_belongs_to_a_company', null),
  ('20260925090000', 'tenant_org_nr_unique', null),
  ('20260925100000', 'the_trial_runs_out', null),
  ('20260928100000', 'the_cli_ledger_matches_reality', null)
on conflict (version) do nothing;
