-- ============================================================================
-- SOFT-CANCEL IN-PROGRESS SHIFTS
--
-- Adds cancelled_at to tilldelning so an admin can mark a running shift as
-- cancelled without destroying its data. The row is preserved for audit;
-- cancelled shifts are excluded from headcount, aktiva displays and the
-- confirmation queue.
--
-- New RPCs:
--   cancel_shift(p_tilldelning)   — admin only; shift must be in progress
--   uncancel_shift(p_tilldelning) — admin only; clears cancelled_at
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add the column
-- ---------------------------------------------------------------------------
ALTER TABLE public.tilldelning
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Rebuild my_shift to include cancelled_at.
--    Workers still see their cancelled shift so they can clock out (audit row)
--    and so the UI can show the cancellation notice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.my_shift WITH (security_invoker = false) AS
 SELECT t.id,
    t.pass_id,
    p.project_id,
    pr.name AS project_name,
    pr.site_address,
    p.work_date,
    COALESCE(t.own_start, p.start_time) AS start_time,
    COALESCE(t.own_end, p.end_time) AS end_time,
    p.planned_hours,
    t.clock_in,
    t.clock_out,
    t.cancelled_at,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM public.arbetsdagbok a
              WHERE a.project_id = p.project_id AND p.work_date <@ a.covered)) THEN t.confirmed_hours
            ELSE NULL::numeric
        END AS confirmed_hours,
    pd.confirmed_at IS NOT NULL AS day_confirmed,
    (EXISTS ( SELECT 1
           FROM public.arbetsdagbok a
          WHERE a.project_id = p.project_id AND p.work_date <@ a.covered)) AS filed,
    ( SELECT CASE WHEN e.kind = 'lunch_start' THEN e.at END
        FROM public.stamp_event e
       WHERE e.tilldelning_id = t.id AND e.kind IN ('lunch_start', 'lunch_end')
       ORDER BY e.at DESC, e.id DESC
       LIMIT 1) AS lunch_since
   FROM public.tilldelning t
     JOIN public.pass p ON p.id = t.pass_id AND p.deleted_at IS NULL
     JOIN public.project pr ON pr.id = p.project_id AND pr.deleted_at IS NULL
     LEFT JOIN public.project_day pd ON pd.project_id = p.project_id AND pd.work_date = p.work_date
  WHERE app.in_tenant(p.tenant_id) AND t.released_at IS NULL AND t.worker_id = app.current_worker_id();

-- ---------------------------------------------------------------------------
-- 3. cancel_shift — admin only; shift must be in-progress
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_shift(p_tilldelning uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
declare
  v_row public.tilldelning;
begin
  if not app.is_admin() then
    raise exception 'only an admin may cancel a shift'
      using errcode = 'insufficient_privilege';
  end if;

  perform app.guard_tenant('tilldelning', p_tilldelning);

  select t.* into v_row
  from public.tilldelning t
  where t.id = p_tilldelning;

  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;

  if v_row.released_at is not null then
    raise exception 'this assignment has already been released'
      using errcode = 'check_violation';
  end if;

  if v_row.clock_in is null then
    raise exception 'skiftet har inte börjat — använd Avboka Pass'
      using errcode = 'check_violation';
  end if;

  if v_row.clock_out is not null then
    raise exception 'skiftet är redan avslutat'
      using errcode = 'check_violation';
  end if;

  update public.tilldelning t
     set cancelled_at = now()
   where t.id = p_tilldelning;
end $function$;

COMMENT ON FUNCTION public.cancel_shift(uuid) IS
  'Admin-only: soft-cancel an in-progress shift (clock_in IS NOT NULL, '
  'clock_out IS NULL). Sets cancelled_at = now(). The row and its clock '
  'data are preserved for audit. The worker can still clock out.';

GRANT EXECUTE ON FUNCTION public.cancel_shift(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. uncancel_shift — admin only; clears cancelled_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.uncancel_shift(p_tilldelning uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
declare
  v_row public.tilldelning;
begin
  if not app.is_admin() then
    raise exception 'only an admin may un-cancel a shift'
      using errcode = 'insufficient_privilege';
  end if;

  perform app.guard_tenant('tilldelning', p_tilldelning);

  select t.* into v_row
  from public.tilldelning t
  where t.id = p_tilldelning;

  if v_row.id is null then
    raise exception 'no such assignment' using errcode = 'check_violation';
  end if;

  if v_row.cancelled_at is null then
    raise exception 'this assignment is not cancelled'
      using errcode = 'check_violation';
  end if;

  update public.tilldelning t
     set cancelled_at = null
   where t.id = p_tilldelning;
end $function$;

COMMENT ON FUNCTION public.uncancel_shift(uuid) IS
  'Admin-only: restore a cancelled shift by clearing cancelled_at. '
  'If the worker already clocked out, the shift re-appears in the '
  'confirmation queue and may be included in the Arbetsdagbok normally.';

GRANT EXECUTE ON FUNCTION public.uncancel_shift(uuid) TO authenticated;
