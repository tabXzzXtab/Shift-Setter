-- ============================================================================
-- AVBOKA PASS on a worker -- Step 5b.
--
-- Taking someone off a shift reopens their slot. Headcount does not drop: the
-- pass still needs the same number of people.
--
-- WHAT CHANGES, AND WHY IT IS NOT A CHANGE TO THE CASCADE.
--
-- public.release_assignment() runs the automatic path: a slot freed by
-- something with no human standing over it -- an account paused, a shift
-- deleted, a Snabb Pass taking someone off an earlier booking -- reopens and
-- refills down the tiers by itself. That is Step 5 and it stays exactly as it
-- is, negative controls and all.
--
-- Avboka Pass is the other case. A leader is right there, looking at the day,
-- and Step 5b says to ask them: if anyone who marked förval is free, a popup
-- lists them and picking one fills the slot on the spot. The tiers are for
-- when nobody is available to ask. So this function releases WITHOUT filling
-- and hands back the candidates; the cards go out only when that list is
-- empty, which is the one case where a popup would ask a question with no
-- answers in it.
--
-- THE FIVE-DAY RULE SPLITS, and deliberately. Picking a name off a list is
-- manual placement, which Step 5 has always allowed however close the shift
-- is -- a leader choosing a person is the opposite of an automatic refill. So
-- the popup fires at any distance. The Acceptera Pass cards are the automatic
-- half, and they still do not go out inside five days.
-- ============================================================================

create or replace function public.avboka_pass(p_tilldelning uuid)
returns jsonb
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_row     public.tilldelning;
  v_pass    public.pass;
  v_beyond  boolean;
  v_people  jsonb;
  v_offered integer := 0;
  v         record;
begin
  select t.* into v_row from public.tilldelning t where t.id = p_tilldelning;
  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;

  select p.* into v_pass from public.pass p where p.id = v_row.pass_id;

  if not app.leads_project(v_pass.project_id) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
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
end $fn$;

-- ---------------------------------------------------------------------------
-- The choice, once it is made.
--
-- Deliberately not restricted to the names the popup offered. Step 5 allows
-- manual assignment at any distance from the shift, and the guards behind this
-- are the real limits: the headcount trigger refuses an overfill and invariant
-- 2's index refuses a second assignment on the same date, whoever is named.
-- ---------------------------------------------------------------------------
create or replace function public.place_replacement(p_pass uuid, p_worker uuid)
returns void
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_pass public.pass;
begin
  select p.* into v_pass from public.pass p where p.id = p_pass and p.deleted_at is null;
  if v_pass.id is null then
    raise exception 'no such shift' using errcode = 'check_violation';
  end if;

  if not app.leads_project(v_pass.project_id) then
    raise exception 'not your project' using errcode = 'insufficient_privilege';
  end if;

  insert into public.tilldelning (pass_id, worker_id, source, work_date)
  values (p_pass, p_worker, 'manuell', v_pass.work_date);
end $fn$;

grant execute on function public.avboka_pass(uuid) to authenticated;
grant execute on function public.place_replacement(uuid, uuid) to authenticated;
