-- ============================================================================
-- M2b -- THE FUNCTIONS RLS CANNOT REACH.
--
-- SECURITY DEFINER runs as the owner, so no policy applies inside one. M2a
-- scoped every read and write that goes through a policy; these twenty-one
-- take a uuid and act on it, and until now nothing asked whose uuid it was.
-- Tenant A's admin passing tenant B's pass id to delete_pass deleted it.
--
-- Isolation has been real for reads since M2a and porous for these writes.
-- This closes that.
--
-- FOUR FUNCTIONS PEOPLE EXPECT HERE ARE NOT, because they are SECURITY
-- INVOKER and M2a already covers them through the project_day and day_review
-- policies: approve_day, reject_day, confirm_flagged_day and
-- complete_bristsurvey. I said the opposite earlier in this work and it was
-- wrong; the catalogue settled it.
--
-- THE GUARD IS ONE LINE PER ARGUMENT, inserted at the top of each function
-- before it does anything. Generated from the live pg_get_functiondef rather
-- than retyped, so nothing else in twenty-one bodies moves.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The guard.
--
-- IT IS SILENT ON A ROW THAT DOES NOT EXIST, deliberately. Every one of these
-- functions already has its own answer for "no such pass" and phrases it for
-- the person reading -- raising "belongs to another company" for a row that
-- was simply deleted would be both wrong and a hint about what exists
-- elsewhere. So the guard fires only when the row IS there and belongs to
-- somebody else.
--
-- Dynamic SQL because the parent table differs per call and the alternative
-- is twenty-one near-identical helpers. The table name never comes from a
-- caller -- it is written into each function body below -- so format('%I')
-- here is quoting, not sanitising.
--
-- STABLE, not VOLATILE: it reads one row and writes nothing, and a guard the
-- planner may cache within a statement is the behaviour wanted.
-- ---------------------------------------------------------------------------

create or replace function app.guard_tenant(p_table text, p_id uuid) returns void
  language plpgsql stable security definer
  set search_path = ''
as $fn$
declare
  v_tenant uuid;
begin
  if p_id is null then return; end if;

  execute format('select tenant_id from public.%I where id = $1', p_table)
     into v_tenant using p_id;

  if v_tenant is not null and not app.in_tenant(v_tenant) then
    raise exception 'that % belongs to another company', p_table
      using errcode = 'insufficient_privilege';
  end if;
end $fn$;

-- accept_offer: p_pass -> pass
CREATE OR REPLACE FUNCTION public.accept_offer(p_pass uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_worker uuid := app.current_worker_id();
  v_id     uuid;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('pass', p_pass);
  if v_worker is null then
    raise exception 'no worker record for this account' using errcode = 'insufficient_privilege';
  end if;

  -- `declined` is this worker's own Neka and nothing else writes it, so the
  -- pass they turned down stays theirs to take back while the slot is open.
  -- `withdrawn` is the system's word, not theirs, and is still a refusal.
  if not exists (select 1 from public.pass_offer o
                 where o.pass_id = p_pass and o.worker_id = v_worker
                   and o.state in ('offered', 'declined')) then
    raise exception 'this shift is not offered to you' using errcode = 'insufficient_privilege';
  end if;

  -- INVARIANT 2 is the partial unique index; this is the friendly message.
  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  values (p_pass, v_worker, 'oppen', (select p.work_date from public.pass p where p.id = p_pass))
  returning id into v_id;

  update public.pass_offer o set state = 'accepted', responded_at = now()
  where o.pass_id = p_pass and o.worker_id = v_worker;

  -- The pass vanishes from everyone else's queue once headcount is met.
  update public.pass_offer o set state = 'withdrawn', responded_at = now()
  where o.pass_id = p_pass and o.state = 'offered'
    and (select count(*) from public.tilldelning t
         where t.pass_id = p_pass and t.released_at is null
           and t.source <> 'ledare')
        >= (select p.headcount from public.pass p where p.id = p_pass);

  return v_id;
end $function$
;

-- assign_snabb: p_pass -> pass, p_worker -> worker
CREATE OR REPLACE FUNCTION public.assign_snabb(p_pass uuid, p_worker uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pass public.pass;
  v_id   uuid;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('pass', p_pass);
  perform app.guard_tenant('worker', p_worker);
  if not app.is_admin() then
    raise exception 'only an admin creates a Snabb Pass' using errcode = 'insufficient_privilege';
  end if;

  select p.* into v_pass from public.pass p where p.id = p_pass and p.deleted_at is null;
  if v_pass.id is null then
    raise exception 'no such shift' using errcode = 'check_violation';
  end if;

  -- "If that person held an assignment elsewhere that day, the Snabb Pass wins
  -- and the earlier one is released." Both halves in one transaction, so
  -- INVARIANT 2 is never momentarily false.
  update public.tilldelning t
  set released_at = now(), released_reason = 'replaced_by_snabb', released_by = (select auth.uid())
  where t.worker_id = p_worker and t.work_date = v_pass.work_date and t.released_at is null;

  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  values (p_pass, p_worker, 'snabb', v_pass.work_date)
  returning id into v_id;

  return v_id;
end $function$
;

-- avboka_pass: p_tilldelning -> tilldelning
CREATE OR REPLACE FUNCTION public.avboka_pass(p_tilldelning uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row     public.tilldelning;
  v_pass    public.pass;
  v_beyond  boolean;
  v_people  jsonb;
  v_offered integer := 0;
  v         record;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('tilldelning', p_tilldelning);
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;

  select p.* into v_pass from public.pass p where p.id = v_row.pass_id;

  if not app.leads_project(v_pass.project_id) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  -- STEP 4b. A leader's row is not a slot and this is not the way off it.
  -- Taking an arbetsledare off a day forces the question of who is answerable
  -- for it, which is Step 5c's popup, not this one.
  if v_row.source = 'ledare' then
    raise exception 'an arbetsledare is not removed this way; a replacement must be chosen'
      using errcode = 'insufficient_privilege';
  end if;

  update public.tilldelning t
  set released_at = now(), released_reason = 'removed_by_leader', released_by = (select auth.uid())
  where t.id = p_tilldelning and t.released_at is null;

  -- Never re-offered to the person taken off. Snabb Pass is the way back.
  insert into public.pass_block (pass_id, worker_id)
  values (v_row.pass_id, v_row.worker_id)
  on conflict do nothing;

  update public.pass_offer o
  set state = 'withdrawn', responded_at = now()
  where o.pass_id = v_row.pass_id and o.worker_id = v_row.worker_id and o.state = 'offered';

  -- WHO IS FREE. Marked the day can-work, still employed, still able to sign
  -- in, not already working that date, and not someone taken off this very
  -- pass. The same filters the tier walk applies, asked as a question instead
  -- of acted on.
  select coalesce(jsonb_agg(jsonb_build_object('worker_id', c.id, 'name', c.name)
                            order by c.name), '[]'::jsonb)
    into v_people
  from (
    select w.id, w.name
    from public.forval f
    join public.worker w  on w.id = f.worker_id and w.deleted_at is null
    join public.account a on a.id = w.account_id and a.active
    where f.work_date = v_pass.work_date
      and f.can_work
      and not exists (
        select 1 from public.tilldelning t2
        where t2.worker_id = w.id and t2.work_date = v_pass.work_date
          and t2.released_at is null
      )
      and not exists (
        select 1 from public.pass_block b
        where b.pass_id = v_row.pass_id and b.worker_id = w.id
      )
  ) c;

  v_beyond := app.pass_start_at(v_pass.work_date, v_pass.start_time) > now() + interval '5 days';

  -- Cards only when there is nobody to ask. app.fill_pass is reused rather
  -- than reimplemented: with the candidate list empty its förval tiers find
  -- nobody by construction, so what it does here is exactly Tier 3.
  if v_people = '[]'::jsonb and v_beyond then
    select * into v from app.fill_pass(v_row.pass_id);
    v_offered := v.offered;
  end if;

  return jsonb_build_object(
    'pass_id',      v_row.pass_id,
    'work_date',    v_pass.work_date,
    'beyond_five_days', v_beyond,
    'offered',      v_offered,
    'replacements', v_people
  );
end $function$
;

-- bristsurvey_gaps: p_project -> project
CREATE OR REPLACE FUNCTION public.bristsurvey_gaps(p_project uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project public.project;
  v_covered daterange := daterange(p_from, p_to + 1, '[)');
  v_missing text[] := '{}';
  v_leaders jsonb;
  v_days    jsonb;
  v_shifts  integer;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('project', p_project);
  if not app.is_admin() then
    raise exception 'only an admin runs a bristsurvey'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_project from public.project p where p.id = p_project;
  if v_project.id is null or v_project.deleted_at is not null then
    raise exception 'no such project' using errcode = 'check_violation';
  end if;

  -- The four cover values, in the order the document prints them.
  if btrim(v_project.name) = ''               then v_missing := v_missing || 'name'; end if;
  if btrim(v_project.bestallare_bolag) = ''   then v_missing := v_missing || 'bestallare_bolag'; end if;
  if btrim(v_project.bestallare_address) = '' then v_missing := v_missing || 'bestallare_address'; end if;
  if btrim(v_project.bestallare_orgnr) = ''   then v_missing := v_missing || 'bestallare_orgnr'; end if;

  select count(*) into v_shifts
  from public.pass p
  where p.project_id = p_project and p.deleted_at is null and p.work_date <@ v_covered;

  -- Who owed the confirmation. Named on screen so the admin can chase them
  -- instead of taking the day off them, which is the better outcome.
  select coalesce(jsonb_agg(d.name order by d.name), '[]'::jsonb) into v_leaders
  from public.project_leader pl
  join public.account_directory d on d.id = pl.account_id
  -- A nameless row would render as "null" on the chase screen. Every
  -- arbetsledare is also a worker and so has a name; one without is a broken
  -- account, and showing nothing beats showing a placeholder for a person.
  where pl.project_id = p_project and coalesce(d.active, false) and d.name is not null;

  -- One entry per day that is in the way, with what was registered on it.
  select coalesce(jsonb_agg(s.x order by s.x->>'work_date'), '[]'::jsonb) into v_days
  from (
    select jsonb_build_object(
      'work_date',     g.work_date,
      'needs_confirm', pd.confirmed_at is null,
      'needs_text',    pd.vad_vi_gjorde is null or btrim(pd.vad_vi_gjorde) = '',
      'vad_vi_gjorde', pd.vad_vi_gjorde,
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'worker', w.name,
                 'tider',  case
                             when t.clock_in is not null and t.clock_out is not null
                             then to_char(t.clock_in  at time zone 'Europe/Stockholm', 'HH24:MI')
                               || '-'
                               || to_char(t.clock_out at time zone 'Europe/Stockholm', 'HH24:MI')
                             else to_char(p.start_time, 'HH24:MI')
                               || '-' || to_char(p.end_time, 'HH24:MI')
                           end,
                 'timmar', case
                             when t.clock_in is not null and t.clock_out is not null
                             then round(extract(epoch from (t.clock_out - t.clock_in)) / 3600.0, 2)
                             else p.planned_hours
                           end,
                 'stamplat', t.clock_in is not null and t.clock_out is not null
               ) order by w.name), '[]'::jsonb)
        from public.tilldelning t
        join public.pass p   on p.id = t.pass_id
        join public.worker w on w.id = t.worker_id
        where p.project_id = p_project and p.work_date = g.work_date
          and p.deleted_at is null and t.released_at is null
      )
    ) as x
    from (
      select distinct p.work_date
      from public.pass p
      where p.project_id = p_project and p.deleted_at is null and p.work_date <@ v_covered
    ) g
    left join public.project_day pd
      on pd.project_id = p_project and pd.work_date = g.work_date
    where pd.confirmed_at is null
       or pd.vad_vi_gjorde is null
       or btrim(pd.vad_vi_gjorde) = ''
  ) s;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id',                 v_project.id,
      'name',               v_project.name,
      'bestallare_bolag',   v_project.bestallare_bolag,
      'bestallare_address', v_project.bestallare_address,
      'bestallare_orgnr',   v_project.bestallare_orgnr,
      'missing',            to_jsonb(v_missing)
    ),
    'leaders',    v_leaders,
    'has_shifts', v_shifts > 0,
    'days',       v_days
  );
end $function$
;

-- clock_in: p_tilldelning -> tilldelning
CREATE OR REPLACE FUNCTION public.clock_in(p_tilldelning uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_worker uuid := app.current_worker_id();
  v_now    timestamptz := now();
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('tilldelning', p_tilldelning);
  update public.tilldelning t
  set clock_in = v_now
  where t.id = p_tilldelning
    and t.worker_id = v_worker
    and t.released_at is null
    and t.clock_in is null;

  if not found then
    raise exception 'not your shift, already clocked in, or no longer assigned'
      using errcode = 'insufficient_privilege';
  end if;
  return v_now;
end $function$
;

-- clock_out: p_tilldelning -> tilldelning
CREATE OR REPLACE FUNCTION public.clock_out(p_tilldelning uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_worker uuid := app.current_worker_id();
  v_now    timestamptz := now();
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('tilldelning', p_tilldelning);
  update public.tilldelning t
  set clock_out = v_now
  where t.id = p_tilldelning
    and t.worker_id = v_worker
    and t.released_at is null
    and t.clock_in is not null
    and t.clock_out is null;

  if not found then
    raise exception 'not your shift, not clocked in, or already clocked out'
      using errcode = 'insufficient_privilege';
  end if;
  return v_now;
end $function$
;

-- close_pass: p_pass -> pass
CREATE OR REPLACE FUNCTION public.close_pass(p_pass uuid, p_hours numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pass  public.pass;
  v_now   timestamptz := now();
  v_stage public.day_stage;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('pass', p_pass);
  if not app.is_admin() then
    raise exception 'Endast administratören kan stänga ett pågående pass.'
      using errcode = 'insufficient_privilege';
  end if;

  select p.* into v_pass
  from public.pass p where p.id = p_pass and p.deleted_at is null;
  if v_pass.id is null then
    raise exception 'Passet finns inte, eller är redan borttaget.'
      using errcode = 'check_violation';
  end if;

  -- RUNNING, and nothing else. A pass that has not started is a plan and is
  -- deleted; one that has ended is a fact and is confirmed. Closing is only
  -- for the window between, and saying so keeps the three acts apart.
  if v_now < app.pass_start_at(v_pass.work_date, v_pass.start_time) then
    raise exception 'Passet har inte börjat än. Ta bort det i stället.'
      using errcode = 'check_violation';
  end if;
  if v_now >= app.pass_end_at(v_pass.work_date, v_pass.start_time, v_pass.end_time) then
    raise exception 'Passet är redan slut. Det bekräftas i stället.'
      using errcode = 'check_violation';
  end if;

  select pd.stage into v_stage
  from public.project_day pd
  where pd.project_id = v_pass.project_id and pd.work_date = v_pass.work_date;
  if v_stage = 'admin_confirmed' then
    raise exception 'Dagen är godkänd och låst. Den kan inte ändras.'
      using errcode = 'insufficient_privilege';
  end if;

  -- INVARIANT 1. A human typed this; nothing here derives it. Zero is a real
  -- answer -- a pass closed before anyone got started -- so only absence and
  -- nonsense are refused.
  if p_hours is null or p_hours < 0 then
    raise exception 'Ange hur många timmar passet har jobbat.'
      using errcode = 'check_violation';
  end if;

  -- They turned up. The row stays and carries the figure.
  update public.tilldelning t
  set confirmed_hours = p_hours
  where t.pass_id = p_pass
    and t.released_at is null
    and t.source <> 'ledare'
    and t.clock_in is not null;

  -- They did not. Released, and it prints nowhere.
  update public.tilldelning t
  set released_at = v_now, released_reason = 'closed_early',
      released_by = (select auth.uid())
  where t.pass_id = p_pass
    and t.released_at is null
    and t.source <> 'ledare'
    and t.clock_in is null;

  -- Everyone who held the pass is told, whichever way they went. Somebody
  -- still on site is the person who most needs to know it is over.
  insert into public.notification (account_id, kind, payload)
  select w.account_id, 'pass_closed',
         jsonb_build_object('pass_id', p_pass, 'work_date', v_pass.work_date,
                            'project_id', v_pass.project_id, 'hours', p_hours)
  from public.tilldelning t
  join public.worker w on w.id = t.worker_id
  where t.pass_id = p_pass and t.source <> 'ledare' and w.account_id is not null
    and (t.released_at is null or t.released_reason = 'closed_early');

  -- AND THE PASS ENDS NOW. This is what makes it stop being "pågående": the
  -- span on the record is what the day actually ran, so the leader's envelope,
  -- Nästa Pass and every "has it ended yet" test agree without being told
  -- separately. A night shift closed after midnight keeps end < start, which
  -- app.pass_end_at already reads as the following day.
  update public.pass
  set end_time = (v_now at time zone 'Europe/Stockholm')::time
  where id = p_pass;
end $function$
;

-- create_snabb_pass: p_project -> project, p_worker -> worker
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

  -- ASKED BEFORE ANYTHING IS WRITTEN. A day that reached admin_confirmed is
  -- final under invariant 5, and that is not a rule Snabb Pass gets to bend --
  -- those hours are already in an Arbetsdagbok. Refusing in the admin's own
  -- language beats letting a trigger three levels down do it in the
  -- database's.
  select pr.name || ' ' || to_char(p.start_time, 'HH24:MI')
                 || '-' || to_char(p.end_time, 'HH24:MI')
    into v_stuck
  from public.tilldelning t
  join public.pass p       on p.id = t.pass_id and p.deleted_at is null
  join public.project pr   on pr.id = p.project_id
  join public.project_day pd on pd.project_id = p.project_id and pd.work_date = p.work_date
  where t.worker_id   = p_worker
    and t.released_at is null
    and t.source     <> 'ledare'
    and t.work_date between p_date - 1 and p_date + 1
    and pd.stage = 'admin_confirmed'
    and app.pass_start_at(p.work_date, p.start_time) < app.pass_end_at(p_date, p_start, p_end)
    and app.pass_start_at(p_date, p_start) < app.pass_end_at(p.work_date, p.start_time, p.end_time)
  limit 1;

  if v_stuck is not null then
    raise exception
      '% har ett pass som krockar (%) och den dagen är redan bekräftad och låst. Ändra tiderna eller välj en annan person.',
      v_name, v_stuck
      using errcode = 'insufficient_privilege';
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

  -- ONLY WHAT IT COLLIDES WITH. A morning shift and an afternoon Snabb Pass
  -- are two things that happened, and the Arbetsdagbok has a row for each.
  update public.tilldelning t
  set released_at = now(), released_reason = 'replaced_by_snabb',
      released_by = (select auth.uid())
  from public.pass p
  where p.id = t.pass_id and p.deleted_at is null
    and t.worker_id   = p_worker
    and t.released_at is null
    and t.source     <> 'ledare'          -- never takes a leader off their day
    and t.work_date between p_date - 1 and p_date + 1
    and app.pass_start_at(p.work_date, p.start_time) < app.pass_end_at(p_date, p_start, p_end)
    and app.pass_start_at(p_date, p_start) < app.pass_end_at(p.work_date, p.start_time, p.end_time);

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
end $function$
;

-- decline_offer: p_pass -> pass
CREATE OR REPLACE FUNCTION public.decline_offer(p_pass uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('pass', p_pass);
  update public.pass_offer o set state = 'declined', responded_at = now()
  where o.pass_id = p_pass and o.worker_id = app.current_worker_id() and o.state = 'offered';
end $function$
;

-- delete_account: p_account -> account
CREATE OR REPLACE FUNCTION public.delete_account(p_account uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_deleted timestamptz;
  v_mode    text;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('account', p_account);
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
end $function$
;

-- delete_pass: p_pass -> pass
CREATE OR REPLACE FUNCTION public.delete_pass(p_pass uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('pass', p_pass);
  update public.pass set deleted_at = now()
  where id = p_pass and deleted_at is null;

  if not found then
    raise exception 'no such shift, or it is already deleted' using errcode = 'check_violation';
  end if;
end $function$
;

-- delete_project: p_project -> project
CREATE OR REPLACE FUNCTION public.delete_project(p_project uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_deleted timestamptz;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('project', p_project);
  -- Not app.leads_project(): that one falls back to is_admin(), which reads
  -- the right way round here but says the wrong thing. Deleting a project is
  -- an admin act, not a leader act that an admin happens to also be allowed.
  if not app.is_admin() then
    raise exception 'only an admin deletes a project'
      using errcode = 'insufficient_privilege';
  end if;

  select p.deleted_at into v_deleted from public.project p where p.id = p_project;

  if not found then
    raise exception 'no such project' using errcode = 'check_violation';
  end if;

  if v_deleted is not null then
    raise exception 'project is already deleted' using errcode = 'check_violation';
  end if;

  if exists (
    select 1
      from public.pass p
      join public.tilldelning t on t.pass_id = p.id
     where p.project_id  = p_project
       and p.deleted_at is null
       and p.work_date  >= app.stockholm_today()   -- INVARIANT 9, Stockholm
       and t.released_at is null
  ) then
    raise exception 'project has active passes with workers assigned'
      using errcode = 'check_violation';
  end if;

  update public.project set deleted_at = now() where id = p_project;
end $function$
;

-- fill_passes: p_batch -> pass_batch
CREATE OR REPLACE FUNCTION public.fill_passes(p_batch uuid)
 RETURNS TABLE(filled_pass uuid, for_date date, slots integer, filled integer, offered integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project uuid;
  r         record;
  v         record;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('pass_batch', p_batch);
  select b.project_id into v_project from public.pass_batch b where b.id = p_batch;
  if v_project is null then
    raise exception 'no such batch' using errcode = 'check_violation';
  end if;
  if not app.leads_project(v_project) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select p.id, p.work_date as wd, p.headcount
    from public.pass p
    where p.batch_id = p_batch and p.deleted_at is null
    order by p.work_date, p.start_time
  loop
    select * into v from app.fill_pass(r.id);

    filled_pass := r.id;
    for_date := r.wd;
    slots := r.headcount;
    filled := v.filled;
    offered := v.offered;
    return next;
  end loop;
end $function$
;

-- leader_replacement_options: p_tilldelning -> tilldelning
CREATE OR REPLACE FUNCTION public.leader_replacement_options(p_tilldelning uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row     public.tilldelning;
  v_project public.project;
  v_name    text;
  v_leaders jsonb;
  v_roster  jsonb;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('tilldelning', p_tilldelning);
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null or v_row.source <> 'ledare' then
    raise exception 'that is not an arbetsledare''s day' using errcode = 'check_violation';
  end if;

  if not app.leads_project(v_row.project_id) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  select * into v_project from public.project p where p.id = v_row.project_id;
  select w.name into v_name from public.worker w where w.id = v_row.worker_id;

  -- Every arbetsledare not already working that day, whatever project they are
  -- on: a replacement comes from wherever one is free. Someone already on the
  -- day is not free, including on this very project -- both its leaders are
  -- placed automatically, so the other one is already here.
  select coalesce(jsonb_agg(jsonb_build_object('worker_id', c.id, 'name', c.name)
                            order by c.name), '[]'::jsonb)
    into v_leaders
  from (
    select w.id, w.name
    from public.account a
    join public.worker  w on w.account_id = a.id and w.deleted_at is null
    where a.role = 'arbetsledare'
      and a.active
      and w.id <> v_row.worker_id
      and not exists (
        select 1 from public.tilldelning t
        where t.worker_id = w.id and t.work_date = v_row.work_date
          and t.released_at is null
      )
  ) c;

  -- The people actually on the shift. Route 2 picks from these and nowhere
  -- else: somebody who was not there cannot have been in charge.
  select coalesce(jsonb_agg(distinct jsonb_build_object('worker_id', w.id, 'name', w.name)),
                  '[]'::jsonb)
    into v_roster
  from public.tilldelning t
  join public.worker w on w.id = t.worker_id and w.deleted_at is null
  where t.project_id  = v_row.project_id
    and t.work_date   = v_row.work_date
    and t.released_at is null
    and t.source <> 'ledare';

  return jsonb_build_object(
    'tilldelning',  v_row.id,
    'leader_name',  v_name,
    'project_id',   v_row.project_id,
    'project_name', v_project.name,
    'work_date',    v_row.work_date,
    'leaders',      v_leaders,
    'roster',       v_roster
  );
end $function$
;

-- leave_day_unsupervised: p_tilldelning -> tilldelning
CREATE OR REPLACE FUNCTION public.leave_day_unsupervised(p_tilldelning uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('tilldelning', p_tilldelning);
  perform app.flag_day(p_tilldelning, 'ingen_ledare', null);
end $function$
;

-- make_worker_ansvarig: p_tilldelning -> tilldelning, p_worker -> worker
CREATE OR REPLACE FUNCTION public.make_worker_ansvarig(p_tilldelning uuid, p_worker uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.tilldelning;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('tilldelning', p_tilldelning);
  perform app.guard_tenant('worker', p_worker);
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;


  -- Gör Arbetare Ansvarig is the fallback for having nobody to hand the day
  -- to, and the spec offers it only when the replacement list is empty. That
  -- rule lived in the popup, which makes it decorative: the database is the
  -- only real boundary, and a worker covering a day an arbetsledare could
  -- have taken is a flagged day that did not have to be one.
  --
  -- The same set the popup lists, asked as a question.
  if exists (
    select 1
    from public.account a
    join public.worker  w on w.account_id = a.id and w.deleted_at is null
    where a.role = 'arbetsledare'
      and a.active
      and w.id <> v_row.worker_id
      and not exists (
        select 1 from public.tilldelning t
        where t.worker_id = w.id and t.work_date = v_row.work_date
          and t.released_at is null
      )
  ) then
    raise exception 'an arbetsledare is free that day; one of them takes it before a worker does'
      using errcode = 'check_violation';
  end if;

  -- Somebody who was not there cannot have been in charge.
  if not exists (
    select 1 from public.tilldelning t
    where t.worker_id   = p_worker
      and t.project_id  = v_row.project_id
      and t.work_date   = v_row.work_date
      and t.released_at is null
      and t.source     <> 'ledare'
  ) then
    raise exception 'that person is not on this shift'
      using errcode = 'check_violation';
  end if;

  perform app.flag_day(p_tilldelning, 'worker_ansvarig', p_worker);
end $function$
;

-- place_replacement: p_pass -> pass, p_worker -> worker
CREATE OR REPLACE FUNCTION public.place_replacement(p_pass uuid, p_worker uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pass public.pass;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('pass', p_pass);
  perform app.guard_tenant('worker', p_worker);
  select p.* into v_pass from public.pass p where p.id = p_pass and p.deleted_at is null;
  if v_pass.id is null then
    raise exception 'no such shift' using errcode = 'check_violation';
  end if;

  if not app.leads_project(v_pass.project_id) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  values (p_pass, p_worker, 'manuell', v_pass.work_date);
end $function$
;

-- release_assignment: p_tilldelning -> tilldelning
CREATE OR REPLACE FUNCTION public.release_assignment(p_tilldelning uuid, p_reason release_reason DEFAULT 'removed_by_leader'::release_reason)
 RETURNS TABLE(reopened boolean, filled integer, offered integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row     public.tilldelning;
  v_pass    public.pass;
  v_project uuid;
  v         record;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('tilldelning', p_tilldelning);
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;

  select p.* into v_pass from public.pass p where p.id = v_row.pass_id;
  v_project := v_pass.project_id;

  if not app.leads_project(v_project) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  update public.tilldelning t
  set released_at = now(), released_reason = p_reason, released_by = (select auth.uid())
  where t.id = p_tilldelning and t.released_at is null;

  -- Never re-offered to the person taken off. Snabb Pass is the way back.
  insert into public.pass_block (pass_id, worker_id) values (v_row.pass_id, v_row.worker_id)
  on conflict do nothing;

  -- Any open offer this person held on the pass goes with them.
  update public.pass_offer o
  set state = 'withdrawn', responded_at = now()
  where o.pass_id = v_row.pass_id and o.worker_id = v_row.worker_id and o.state = 'offered';

  -- More than five days out: the slot reopens and refills down the list
  -- normally. Inside five days: no auto-fill, by design.
  if app.pass_start_at(v_pass.work_date, v_pass.start_time) > now() + interval '5 days' then
    select * into v from app.fill_pass(v_row.pass_id);
    reopened := true;
    filled := v.filled;
    offered := v.offered;
  else
    reopened := false;
    filled := 0;
    offered := 0;
  end if;

  return next;
end $function$
;

-- replace_leader: p_tilldelning -> tilldelning, p_worker -> worker
CREATE OR REPLACE FUNCTION public.replace_leader(p_tilldelning uuid, p_worker uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.tilldelning;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('tilldelning', p_tilldelning);
  perform app.guard_tenant('worker', p_worker);
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;
  if not app.leads_project(v_row.project_id) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.tilldelning t
             where t.worker_id = p_worker and t.work_date = v_row.work_date
               and t.released_at is null) then
    raise exception 'that arbetsledare is already working that day'
      using errcode = 'check_violation';
  end if;

  v_row := app.take_leader_off(p_tilldelning);

  insert into public.tilldelning
    (pass_id, worker_id, source, work_date, project_id, own_start, own_end)
  values (v_row.pass_id, p_worker, 'ledare', v_row.work_date, v_row.project_id,
          v_row.own_start, v_row.own_end);

  -- Neither of them chose it, so neither should have to find out by looking.
  insert into public.notification (account_id, kind, payload)
  select w.account_id, 'leader_replaced',
         jsonb_build_object('project_id', v_row.project_id,
                            'work_date', v_row.work_date,
                            'taken_over', w.id = p_worker)
  from public.worker w
  where w.id in (v_row.worker_id, p_worker) and w.account_id is not null;
end $function$
;

-- swap_leaders: p_a -> tilldelning, p_b -> tilldelning
CREATE OR REPLACE FUNCTION public.swap_leaders(p_a uuid, p_b uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.tilldelning;
  b public.tilldelning;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('tilldelning', p_a);
  perform app.guard_tenant('tilldelning', p_b);
  if not app.is_admin() then
    raise exception 'only an admin swaps two arbetsledare'
      using errcode = 'insufficient_privilege';
  end if;

  select t.* into a from public.tilldelning t where t.id = p_a;
  select t.* into b from public.tilldelning t where t.id = p_b;

  if a.id is null or b.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;
  if a.source <> 'ledare' or b.source <> 'ledare' then
    raise exception 'both sides of a swap must be an arbetsledare''s day'
      using errcode = 'check_violation';
  end if;
  if a.released_at is not null or b.released_at is not null then
    raise exception 'one of those days is already given up'
      using errcode = 'check_violation';
  end if;
  if a.work_date <> b.work_date then
    raise exception 'a swap is two arbetsledare trading the SAME day'
      using errcode = 'check_violation';
  end if;
  if a.project_id = b.project_id then
    raise exception 'both are already on that project; there is nothing to trade'
      using errcode = 'check_violation';
  end if;
  if a.worker_id = b.worker_id then
    raise exception 'that is the same arbetsledare on both sides'
      using errcode = 'check_violation';
  end if;

  -- Already on the other's project that day: the swap would give them two rows
  -- on one project, which the index forbids and which means nothing anyway.
  if exists (select 1 from public.tilldelning t
             where t.worker_id = a.worker_id and t.work_date = a.work_date
               and t.project_id = b.project_id
               and t.source = 'ledare' and t.released_at is null)
     or exists (select 1 from public.tilldelning t
                where t.worker_id = b.worker_id and t.work_date = b.work_date
                  and t.project_id = a.project_id
                  and t.source = 'ledare' and t.released_at is null) then
    raise exception 'one of them already leads the other''s project that day'
      using errcode = 'check_violation';
  end if;

  -- Released as a removal, because that is the one thing sync_leader_day reads
  -- as "a person decided this". Without it the next roster edit on either day
  -- puts both of them back on their own projects, on top of the swap.
  update public.tilldelning t
  set released_at = now(), released_reason = 'removed_by_leader',
      released_by = (select auth.uid())
  where t.id in (p_a, p_b);

  -- Each replacement keeps the ROW's project, pass and envelope, and changes
  -- only who is standing there. That is what makes own_start/own_end come out
  -- as the new project's span without anything having to recompute it.
  insert into public.tilldelning
    (pass_id, worker_id, source, work_date, project_id, own_start, own_end)
  values
    (a.pass_id, b.worker_id, 'ledare', a.work_date, a.project_id, a.own_start, a.own_end),
    (b.pass_id, a.worker_id, 'ledare', b.work_date, b.project_id, b.own_start, b.own_end);

  -- Neither of them asked for it, so neither should have to find out by
  -- looking. Each is told which project they are on now.
  insert into public.notification (account_id, kind, payload)
  select w.account_id, 'leader_replaced',
         jsonb_build_object(
           'work_date', a.work_date,
           'swapped', true,
           'project_id', case when w.id = a.worker_id then b.project_id else a.project_id end)
  from public.worker w
  where w.id in (a.worker_id, b.worker_id) and w.account_id is not null;
end $function$
;

-- swap_partners: p_tilldelning -> tilldelning
CREATE OR REPLACE FUNCTION public.swap_partners(p_tilldelning uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row     public.tilldelning;
  v_name    text;
  v_project text;
  v_others  jsonb;
begin
  -- M2b: whose row is this? See app.guard_tenant.
  perform app.guard_tenant('tilldelning', p_tilldelning);
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null or v_row.source <> 'ledare' or v_row.released_at is not null then
    raise exception 'that is not an arbetsledare''s day' using errcode = 'check_violation';
  end if;

  if not app.is_admin() then
    raise exception 'only an admin swaps two arbetsledare'
      using errcode = 'insufficient_privilege';
  end if;

  select w.name into v_name from public.worker w where w.id = v_row.worker_id;
  select pr.name into v_project from public.project pr where pr.id = v_row.project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tilldelning',  c.id,
           'worker_id',    c.worker_id,
           'name',         c.name,
           'project_id',   c.project_id,
           'project_name', c.project_name,
           'start_time',   to_char(c.own_start, 'HH24:MI'),
           'end_time',     to_char(c.own_end,   'HH24:MI')
         ) order by c.project_name, c.name), '[]'::jsonb)
    into v_others
  from (
    select t.id, t.worker_id, t.project_id, t.own_start, t.own_end,
           w.name, pr.name as project_name
    from public.tilldelning t
    join public.worker  w  on w.id = t.worker_id and w.deleted_at is null
    join public.project pr on pr.id = t.project_id and pr.deleted_at is null
    where t.work_date   = v_row.work_date
      and t.source      = 'ledare'
      and t.released_at is null
      -- Says what the list is for. It has no independent effect and there is
      -- deliberately no negative control for it: two leaders on ONE project
      -- both hold a row on it, so the overlap test below already excludes
      -- them, and so does it exclude this row itself. Kept because a reader
      -- should not have to derive "a swap is with another project" from two
      -- NOT EXISTS clauses.
      and t.project_id <> v_row.project_id
      -- Neither of them may already hold the other's project that day, or the
      -- swap would give somebody two rows on one project.
      and not exists (
        select 1 from public.tilldelning x
        where x.worker_id = t.worker_id and x.work_date = t.work_date
          and x.project_id = v_row.project_id
          and x.source = 'ledare' and x.released_at is null
      )
      and not exists (
        select 1 from public.tilldelning y
        where y.worker_id = v_row.worker_id and y.work_date = t.work_date
          and y.project_id = t.project_id
          and y.source = 'ledare' and y.released_at is null
      )
  ) c;

  return jsonb_build_object(
    'tilldelning',  v_row.id,
    'leader_name',  v_name,
    'project_name', v_project,
    'work_date',    v_row.work_date,
    'partners',     v_others
  );
end $function$
;

-- forval_coverage counted every tenant's workers. batch_shortfall is a
-- thin wrapper over it and needs no change of its own.
CREATE OR REPLACE FUNCTION public.forval_coverage(p_dates date[])
 RETURNS TABLE(work_date date, available integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select d::date,
         (select count(*)::integer
          from public.forval f
          join public.worker w on w.id = f.worker_id and w.deleted_at is null
            -- M2b: count this company's people, not everybody's.
            and w.tenant_id = app.current_tenant_id()
          where f.work_date = d::date
            and f.can_work
            and not exists (
              select 1 from public.tilldelning t
              where t.worker_id = f.worker_id and t.work_date = d::date and t.released_at is null
            ))
  from unnest(p_dates) as d
$function$
;
