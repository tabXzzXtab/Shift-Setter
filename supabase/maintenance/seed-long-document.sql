-- Seed enough confirmed days to produce a document with middle pages.
--
-- The footer overlap only shows up on a page that is neither the first nor the
-- last, because DocMaker's 30mm bottom padding protects the last page and the
-- cover has no table on it. A two-page document cannot demonstrate it either
-- way, so this makes a five-page one.
--
-- Runs as the assigned arbetsledare, by setting the request claim the way
-- PostgREST would: the confirmation guard deliberately refuses anyone else,
-- and seeding must not be a way around a rule the application obeys.

do $$
declare
  v_project uuid;
  v_leader  uuid;
  v_workers uuid[];
  v_date    date;
  v_pass    uuid;
  v_worker  uuid;
  i         int;
begin
  select p.id, pl.account_id into v_project, v_leader
  from public.project p
  join public.project_leader pl on pl.project_id = p.id
  where p.deleted_at is null
  order by p.created_at
  limit 1;

  if v_project is null then
    raise exception 'no project to seed against -- run the walkthrough first';
  end if;

  select array_agg(id order by name) into v_workers from public.worker where deleted_at is null;
  if array_length(v_workers, 1) < 2 then
    raise exception 'need at least two workers';
  end if;

  -- Become the leader, exactly as a PostgREST request would present them.
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader)::text, false);

  for i in 1..40 loop
    v_date := app.stockholm_today() - i - 5;

    -- Skip a day that already has a confirmed record: confirmation is final.
    continue when exists (
      select 1 from public.project_day d
      where d.project_id = v_project and d.work_date = v_date and d.confirmed_at is not null
    );

    insert into public.pass (project_id, work_date, start_time, end_time,
                             planned_hours, headcount, created_by)
    values (v_project, v_date, '07:00', '16:00', 8.00, 2, v_leader)
    returning id into v_pass;

    foreach v_worker in array v_workers[1:2] loop
      insert into public.tilldelning (pass_id, worker_id, source, work_date, confirmed_hours)
      values (v_pass, v_worker, 'manuell', v_date, 8.00)
      on conflict do nothing;
    end loop;

    insert into public.project_day (project_id, work_date, vad_vi_gjorde,
                                    confirmed_at, confirmed_by, confirmed_via)
    values (v_project, v_date,
            'Rev gammalt tegel, la ny underlagspapp och läkt på södra takfallet.',
            now(), v_leader, 'leader');
  end loop;

  perform set_config('request.jwt.claims', '', false);
  raise notice 'seeded 40 confirmed days on project %', v_project;
end $$;
