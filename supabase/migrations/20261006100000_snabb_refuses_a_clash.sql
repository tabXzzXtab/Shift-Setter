-- A Snabb Pass refuses a clash instead of removing the shift it collides with.
--
-- OWNER'S DECISION, 2026-10-06: "Warn and block. The database refuses the
-- overlapping Snabb Pass instead of removing the old shift." Until now
-- create_snabb_pass released every non-leader assignment of the person whose
-- hours it overlapped (released_reason 'replaced_by_snabb') and stood in its
-- place; only a clash on an admin_confirmed day was refused.
--
-- Now ANY overlap is refused before anything is written, with a Swedish
-- sentence naming the shift in the way. Invariant 2 is unchanged -- it is the
-- reason there is anything to refuse -- and app.tg_no_overlapping_assignment
-- stays underneath as the backstop. A non-overlapping second shift on the same
-- day is still allowed, as invariant 2 says; ledare rows are still exempt.
--
-- The Före route (p_direkt) is untouched here. The screen stops offering it in
-- the same change; the parameter keeps its default of false.
--
-- 'replaced_by_snabb' stays in the release_reason enum: rows released that way
-- before today still carry it, and they are history.

CREATE OR REPLACE FUNCTION public.create_snabb_pass(p_project uuid, p_worker uuid, p_date date, p_start time without time zone, p_end time without time zone, p_hours numeric, p_direkt boolean DEFAULT false, p_text text DEFAULT NULL::text, p_ledare jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pass    uuid;
  v_name    text;
  v_stuck   text;
  v_other   integer;
  v_missing text;
  r         jsonb;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('project', p_project);
  perform app.guard_tenant('worker', p_worker);
  if not app.is_admin() then
    raise exception 'only an admin creates a Snabb Pass' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.project p where p.id = p_project and p.deleted_at is null
  ) then
    raise exception 'no such project' using errcode = 'check_violation';
  end if;

  select w.name into v_name
  from public.worker w where w.id = p_worker and w.deleted_at is null;
  if v_name is null then
    raise exception 'no such worker' using errcode = 'check_violation';
  end if;

  -- A CLASH IS REFUSED, NOT RESOLVED (owner's decision, 2026-10-06). A Snabb
  -- Pass used to release whatever of this person's work it overlapped and
  -- stand in its place. Now it never removes anybody's shift: if the hours
  -- overlap, nothing is written and the admin is told which shift is in the
  -- way. The screen warns first and keeps Skapa disabled; this is the same
  -- rule, asked again where it cannot be skipped.
  --
  -- The same comparison as invariant 2's own guard (real timestamps, the day
  -- before to the day after, an end at or before the start rolling to the
  -- next morning), so the two can never disagree about what a clash is. That
  -- guard is still underneath as the backstop; this is here so the refusal is
  -- a Swedish sentence naming the shift rather than the guard's English.
  -- An arbetsledare's own day is not a clash: ledare rows are exempt from the
  -- overlap test (invariant 2), and a Snabb Pass on a leader leaves them
  -- leading.
  select pr.name || ' ' || to_char(p.start_time, 'HH24:MI')
                 || '-' || to_char(p.end_time, 'HH24:MI')
    into v_stuck
  from public.tilldelning t
  join public.pass p       on p.id = t.pass_id and p.deleted_at is null
  join public.project pr   on pr.id = p.project_id
  where t.worker_id   = p_worker
    and t.released_at is null
    and t.source     <> 'ledare'
    and t.work_date between p_date - 1 and p_date + 1
    and app.pass_start_at(p.work_date, p.start_time) < app.pass_end_at(p_date, p_start, p_end)
    and app.pass_start_at(p_date, p_start) < app.pass_end_at(p.work_date, p.start_time, p.end_time)
  order by p.work_date, p.start_time
  limit 1;

  if v_stuck is not null then
    raise exception
      '% har redan ett pass som krockar (%). Ett Snabb Pass tar inte bort ett annat pass — ändra tiderna eller välj en annan person.',
      v_name, v_stuck
      using errcode = 'check_violation';
  end if;

  -- ==========================================================================
  -- FÖRE BEKRÄFTELSE -- everything this route refuses, asked before the write.
  -- All three say what is wrong and what to do instead, because the admin is
  -- standing on a screen with a toggle and the answer is always "turn it off".
  -- ==========================================================================
  if p_direkt then
    select count(*) into v_other
    from public.pass p
    where p.project_id = p_project and p.work_date = p_date
      and p.deleted_at is null;

    if v_other > 0 then
      raise exception
        'Det står redan % pass på det här projektet den %. En dag med fler personer på bekräftas av arbetsledaren — stäng av "Generera arbetsdagbok direkt" så läggs passet till dagen som vanligt.',
        v_other, p_date
        using errcode = 'check_violation';
    end if;

    if p_date > app.stockholm_today() then
      raise exception
        'Den % har inte varit än. Ett pass kan bara föras rakt in i arbetsdagboken i efterhand — välj dagens datum eller tidigare, eller stäng av "Generera arbetsdagbok direkt".',
        p_date
        using errcode = 'check_violation';
    end if;

    if p_text is null or btrim(p_text) = '' then
      raise exception
        'Dagen behöver en beskrivning av vad som gjordes innan den kan föras in i arbetsdagboken. Fyll i "Vad vi gjorde".'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.pass (project_id, work_date, start_time, end_time,
                           planned_hours, headcount, created_by)
  values (p_project, p_date, p_start, p_end, p_hours, 1, (select auth.uid()))
  returning id into v_pass;

  -- The hours the admin typed ARE the confirmed figure on this route: there is
  -- no leader coming along afterwards to state one. On the Efter route the
  -- column stays null and the leader fills it, exactly as before.
  insert into public.tilldelning (pass_id, worker_id, source, work_date, confirmed_hours)
  values (v_pass, p_worker, 'snabb', p_date,
          case when p_direkt then p_hours end);

  if not p_direkt then
    -- EFTER BEKRÄFTELSE. The day waits for the arbetsledare as it always has.
    -- The notification is the only new thing: a Snabb Pass is somebody added
    -- to their day without them, and a leader should not have to notice it.
    insert into public.notification (account_id, kind, payload)
    select pl.account_id, 'snabb_review',
           jsonb_build_object('project_id', p_project,
                              'work_date', p_date,
                              'worker', v_name)
    from public.project_leader pl
    join public.account a on a.id = pl.account_id and a.active
    where pl.project_id = p_project;

    return v_pass;
  end if;

  -- ==========================================================================
  -- FÖRE BEKRÄFTELSE -- the day is closed here, and nothing reopens it.
  -- ==========================================================================

  -- The arbetsledare rows app.sync_leader_day() just created, at the figures
  -- the admin accepted on screen. Matched on worker_id because the assignment
  -- ids did not exist when the screen drew the field.
  for r in select * from jsonb_array_elements(coalesce(p_ledare, '[]'::jsonb)) loop
    update public.tilldelning t
    set confirmed_hours = (r->>'hours')::numeric
    where t.project_id  = p_project
      and t.work_date   = p_date
      and t.source      = 'ledare'
      and t.released_at is null
      and t.worker_id   = (r->>'worker')::uuid;
  end loop;

  -- A row with no figure is a row nobody accepted. The guard would refuse the
  -- confirmation anyway; it would do it by counting, and a count does not tell
  -- the admin whose field they left empty.
  select string_agg(w.name, ', ' order by w.name) into v_missing
  from public.tilldelning t
  join public.pass p   on p.id = t.pass_id and p.deleted_at is null
  join public.worker w on w.id = t.worker_id
  where p.project_id = p_project and p.work_date = p_date
    and t.released_at is null
    and t.confirmed_hours is null;

  if v_missing is not null then
    raise exception
      'Timmar saknas för %. Varje person på dagen behöver en siffra innan dagen förs in i arbetsdagboken.',
      v_missing
      using errcode = 'check_violation';
  end if;

  insert into public.project_day (project_id, work_date, vad_vi_gjorde,
                                  confirmed_at, confirmed_by, confirmed_via)
  values (p_project, p_date, btrim(p_text),
          now(), (select auth.uid()), 'snabb')
  on conflict (project_id, work_date) do update
    set vad_vi_gjorde = btrim(p_text),
        confirmed_at  = now(),
        confirmed_by  = (select auth.uid()),
        confirmed_via = 'snabb';

  return v_pass;
end $function$;

-- The CLI ledger, so `db push` would see this as applied (CLAUDE.md).
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261006100000', 'snabb_refuses_a_clash', null)
on conflict (version) do nothing;
