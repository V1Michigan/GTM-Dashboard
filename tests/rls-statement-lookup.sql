-- psql -X -v ON_ERROR_STOP=1 -f tests/rls-statement-lookup.sql
-- Run as postgres on a local migrated database. All fixture writes roll back.
\set ON_ERROR_STOP on
begin;

insert into people (id, first_name) values
  ('99999999-0000-4000-8000-000000000001', 'RLS test member'),
  ('99999999-0000-4000-8000-000000000002', 'RLS test other member');
insert into app_users (email, role, person_id) values
  ('rls-test-admin@umich.edu', 'admin', null),
  ('rls-test-member@umich.edu', 'member', '99999999-0000-4000-8000-000000000001');
insert into coffee_chats (id, person_id, member_id, created_at) values
  ('99999999-0000-4000-8000-000000000011', '99999999-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000001', now()),
  ('99999999-0000-4000-8000-000000000012', '99999999-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000001', now() - interval '2 days'),
  ('99999999-0000-4000-8000-000000000013', '99999999-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000002', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"email":"rls-test-admin@umich.edu","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from people where id in
    ('99999999-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000002');
  assert n = 2, 'Admin must see both people';
  insert into people (id, first_name) values ('99999999-0000-4000-8000-000000000003', 'Admin write');
  update people set first_name = 'Admin update' where id = '99999999-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  assert n = 1, 'Admin must be able to update';
  delete from people where id = '99999999-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  assert n = 1, 'Admin must be able to delete';
end $$;

-- A stale routing claim does not override the live database role.
select set_config('request.jwt.claims', '{"email":"rls-test-member@umich.edu","role":"authenticated","app_role":"admin"}', true);
do $$
declare n int;
begin
  assert not exists (select from people), 'Member must not read private people rows';
  assert not exists (select from people_list), 'Member must not read the admin list view';
  select count(*) into n from coffee_chats where id in
    ('99999999-0000-4000-8000-000000000011', '99999999-0000-4000-8000-000000000012', '99999999-0000-4000-8000-000000000013');
  assert n = 2, 'Member must see only their own chats';
  insert into coffee_chats (id, person_id, member_id) values
    ('99999999-0000-4000-8000-000000000014', '99999999-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000001');
  begin
    insert into people (first_name) values ('Forbidden');
    raise exception 'Member unexpectedly inserted a person';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into coffee_chats (person_id, member_id) values
      ('99999999-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000002');
    raise exception 'Member unexpectedly inserted another member''s chat';
  exception when insufficient_privilege then null;
  end;
  update coffee_chats set notes = 'Forbidden' where id = '99999999-0000-4000-8000-000000000011';
  get diagnostics n = row_count;
  assert n = 0, 'Member must not update chats';
  delete from coffee_chats where id = '99999999-0000-4000-8000-000000000012';
  get diagnostics n = row_count;
  assert n = 0, 'Member must not delete a chat older than 24 hours';
  delete from coffee_chats where id = '99999999-0000-4000-8000-000000000013';
  get diagnostics n = row_count;
  assert n = 0, 'Member must not delete another member''s chat';
  delete from coffee_chats where id = '99999999-0000-4000-8000-000000000011';
  get diagnostics n = row_count;
  assert n = 1, 'Member must be able to delete their recent chat';
end $$;

-- Demotion must take effect on the next statement, not after the JWT expires.
reset role;
update app_users set role = 'member' where email = 'rls-test-admin@umich.edu';
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"rls-test-admin@umich.edu","role":"authenticated","app_role":"admin"}', true);
do $$ begin
  assert not exists (select from people), 'Demoted admin must immediately lose access';
end $$;
select set_config('request.jwt.claims', '{"email":"rls-test-unknown@umich.edu","role":"authenticated"}', true);
do $$ begin
  assert not exists (select from people), 'Unlisted account must not read private rows';
  assert not exists (select from coffee_chats), 'Unlisted account must not read chats';
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin
    assert not exists (select from people), 'Anonymous must not read private rows';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
update app_users set role = 'admin' where email = 'rls-test-admin@umich.edu';
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"rls-test-admin@umich.edu","role":"authenticated"}', true);
-- This fails on 0012's direct calls and passes when the role lookup is an
-- InitPlan, so it tests the optimization rather than merely matching SQL text.
do $$
declare plan jsonb;
begin
  explain (format json) select count(*) from people into plan;
  assert plan::text like '%InitPlan%', 'Admin role lookup must execute as an InitPlan';
end $$;
reset role;
rollback;
\echo RLS access and statement-lookup checks passed.
