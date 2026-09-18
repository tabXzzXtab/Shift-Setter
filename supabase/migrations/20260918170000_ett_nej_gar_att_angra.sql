-- ============================================================================
-- ETT NEJ GÅR ATT ÅNGRA
--
-- Öppna Pass now carries a Boka Pass button on every card, and the button
-- presses accept_offer. That function required a pass_offer row still in
-- `offered`, which left the screen's own central case refused: Öppna Pass
-- deliberately lists the shifts this worker turned down -- "declining an
-- offer does not block the pass, it only answers the question, so someone
-- whose plans changed on Tuesday can still see the Wednesday they said no
-- to". They could see it and could not take it. A list of things you cannot
-- have is exactly what that screen was written not to be.
--
-- So a worker's OWN decline stops being a bar. `declined` is written by one
-- thing and one thing only -- decline_offer, the Neka button -- so widening
-- the gate to it widens it to precisely "the answer this person gave with
-- their own thumb, which they are now giving again".
--
-- WHAT STAYS SHUT, and why the gate is not simply removed:
--
--   never offered at all -- no row. The tier walk decides who is asked, and
--   förval, lateness and can't-work are how it decides. A worker booking
--   their way past that list would make the ranking advisory.
--
--   `withdrawn` -- the SYSTEM took the offer away: the pass filled, the shift
--   was cancelled, the account was paused, or Avboka released this person and
--   wrote a pass_block so the walk would never hand it back. None of those
--   are a decision this worker is entitled to reverse, and the block is the
--   sharpest of them -- it exists precisely to keep somebody off a shift they
--   were taken off.
--
--   `accepted` -- already theirs, or already released from theirs. Invariant
--   2's partial unique index is what answers a second attempt.
--
-- Nothing else moves. The row lock, the headcount close-out, the insert that
-- invariant 2 guards -- all unchanged; this is the one `where` clause.
-- ============================================================================

create or replace function public.accept_offer(p_pass uuid) returns uuid
  language plpgsql security definer
  set search_path = ''
as $fn$
declare
  v_worker uuid := app.current_worker_id();
  v_id     uuid;
begin
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
end $fn$;
