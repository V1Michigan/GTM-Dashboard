-- Run with psql as postgres against a LOCAL migrated database. Synthetic
-- fixtures are rolled back, even on failure when psql disconnects. Do not run a
-- benchmark against production.
\set ON_ERROR_STOP on
begin;

insert into app_users (email, role) values ('rls-benchmark@umich.edu', 'admin');
insert into people (id, first_name, last_name, grad_year, is_v1_member, slack_joined_at)
select md5('rls-benchmark-person-' || n)::uuid, 'Benchmark', 'Person ' || n,
       2027 + n % 4, n % 5 = 0, case when n % 2 = 0 then now() end
from generate_series(1, 3000) n;
insert into person_emails (person_id, email, is_primary, source)
select md5('rls-benchmark-person-' || n)::uuid, 'rls-benchmark-' || n || '@example.test', true, 'manual'
from generate_series(1, 3000) n;
insert into events (id, name, event_date)
select md5('rls-benchmark-event-' || n)::uuid, 'Benchmark event ' || n, current_date - n
from generate_series(1, 4) n;
insert into event_attendance (event_id, person_id, registered, checked_in)
select md5('rls-benchmark-event-' || e)::uuid, md5('rls-benchmark-person-' || p)::uuid,
       true, p % 2 = 0
from generate_series(1, 4) e cross join generate_series(1, 3000) p;
insert into review_items (kind, payload)
select 'no_match', '{}'::jsonb from generate_series(1, 3000);
analyze;

create temp table rls_timings (stage text, query text, run int, milliseconds numeric);
grant insert, select on rls_timings to authenticated;
create temp table rls_results (stage text, query text, result jsonb);
grant insert, select on rls_results to authenticated;

-- EXPLAIN executes the real views with authenticated RLS; one warmup and five
-- measured runs per query. These are DB execution times, excluding HTTP/cache.
create function pg_temp.measure_rls(stage text) returns void language plpgsql as $$
declare entry record; plan jsonb; result jsonb; n int;
begin
  for entry in select * from (values
    ('people_page', 'select * from people_list order by last_name asc nulls last, first_name asc nulls last, id limit 50'),
    ('people_count', 'select count(*) from people_list'),
    ('overview_stats', 'select * from overview_stats'),
    ('review_count', 'select count(*) from review_items where status = ''open''')
  ) as queries(label, statement) loop
    execute 'select jsonb_agg(q) from (' || entry.statement || ') q' into result;
    insert into rls_results values (stage, entry.label, result);
    for n in 0..5 loop
      execute 'explain (analyze, buffers, format json) ' || entry.statement into plan;
      if n > 0 then
        insert into rls_timings values (stage, entry.label, n, (plan->0->>'Execution Time')::numeric);
      end if;
    end loop;
  end loop;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"email":"rls-benchmark@umich.edu","role":"authenticated"}', true);
select pg_temp.measure_rls('current');
reset role;

select query,
  round((percentile_cont(0.5) within group (order by milliseconds))::numeric, 3) as median_ms
from rls_timings group by query order by query;
rollback;
