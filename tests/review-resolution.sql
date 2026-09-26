-- psql -X -v ON_ERROR_STOP=1 -f tests/review-resolution.sql
-- Run as postgres on a local migrated database. All fixture writes roll back.
\set ON_ERROR_STOP on
begin;

insert into app_users (email, role) values ('review-admin@umich.edu', 'admin'), ('review-member@umich.edu', 'member');
insert into people (id, first_name, last_name) values ('66666666-0000-4000-8000-000000000001', 'Existing', 'Person');
insert into slack_channels (id, name) values ('CREVIEW', 'general');
insert into slack_channel_activity values ('66666666-0000-4000-8000-000000000001', 'CREVIEW', '2026-09-01', 2);

insert into imports (id, source, kind, status) values
  ('66666666-0000-4000-8000-0000000000a1', 'manual_csv', 'people_bulk', 'needs_review');
insert into import_rows (id, import_id, row_index, raw, parsed, row_hash, status) values
  ('66666666-0000-4000-8000-0000000000b1', '66666666-0000-4000-8000-0000000000a1', 1, '{}',
   '{"email":"new-review@umich.edu","first_name":"New","last_name":"Review"}', 'h1', 'review'),
  ('66666666-0000-4000-8000-0000000000b2', '66666666-0000-4000-8000-0000000000a1', 2, '{}',
   '{"email":"linked-review@umich.edu","first_name":"Linked","last_name":"Review"}', 'h2', 'review'),
  ('66666666-0000-4000-8000-0000000000b3', '66666666-0000-4000-8000-0000000000a1', 3, '{}',
   '{"email":"bulk-review@umich.edu","first_name":"Bulk","last_name":"Review"}', 'h3', 'review');
insert into review_items (id, kind, import_row_id, slack_user_id, payload) values
  ('66666666-0000-4000-8000-0000000000c1', 'ambiguous_match', '66666666-0000-4000-8000-0000000000b1', null, '{}'),
  ('66666666-0000-4000-8000-0000000000c2', 'ambiguous_match', '66666666-0000-4000-8000-0000000000b2', null, '{}'),
  ('66666666-0000-4000-8000-0000000000c3', 'no_match', '66666666-0000-4000-8000-0000000000b3', null, '{}'),
  ('66666666-0000-4000-8000-0000000000c4', 'no_match', null, 'UREVIEW1',
   '{"real_name":"Mary Ann Smith","email":"mas@umich.edu"}'),
  ('66666666-0000-4000-8000-0000000000c5', 'ambiguous_match', null, 'UREVIEW2', '{"display_name":"Cher"}'),
  ('66666666-0000-4000-8000-0000000000c6', 'ambiguous_match', null, null, '{}');
insert into slack_unmatched_users (slack_user_id, pending_message_counts) values
  ('UREVIEW2', '{"CREVIEW":{"2026-09-01":3},"CGONE":{"2026-09-01":9}}');

-- The admin guard: psql connects as postgres, which the guard lets through for
-- migrations, so check the role lookup it relies on rather than the call.
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"review-member@umich.edu","role":"authenticated"}', true);
do $$ begin
  assert current_app_role()::text = 'member', 'member is not seen as a member';
end $$;

select set_config('request.jwt.claims', '{"email":"review-admin@umich.edu","role":"authenticated"}', true);

do $$
declare v uuid;
begin
  -- create: the import row is applied as a new person, once
  v := resolve_review_item('66666666-0000-4000-8000-0000000000c1', 'create');
  assert v is not null, 'create returned no person';
  assert (select count(*) from person_emails where email = 'new-review@umich.edu') = 1, 'create: email';
  assert (select status from review_items where id = '66666666-0000-4000-8000-0000000000c1') = 'resolved';
  assert not exists (select from review_items where import_row_id = '66666666-0000-4000-8000-0000000000b1'
                       and status = 'open'), 'create queued a replacement item';

  -- link: the row lands on the chosen person
  v := resolve_review_item('66666666-0000-4000-8000-0000000000c2', 'link', '66666666-0000-4000-8000-000000000001');
  assert v = '66666666-0000-4000-8000-000000000001', 'link returned the wrong person';
  assert exists (select from person_emails where email = 'linked-review@umich.edu'
                   and person_id = '66666666-0000-4000-8000-000000000001'), 'link: email';

  -- Slack create: name split, email attached
  v := resolve_review_item('66666666-0000-4000-8000-0000000000c4', 'create');
  assert (select (first_name, last_name, slack_user_id) = ('Mary Ann', 'Smith', 'UREVIEW1')
            from people where id = v), 'slack create: person';
  assert exists (select from person_emails where person_id = v and email = 'mas@umich.edu'), 'slack create: email';

  -- Slack link: buffered counts are added, unknown channels skipped, buffer cleared
  perform resolve_review_item('66666666-0000-4000-8000-0000000000c5', 'link', '66666666-0000-4000-8000-000000000001');
  assert (select message_count from slack_channel_activity
           where person_id = '66666666-0000-4000-8000-000000000001' and channel_id = 'CREVIEW') = 5,
    'slack link: counts not added';
  assert not exists (select from slack_unmatched_users where slack_user_id = 'UREVIEW2'), 'slack link: buffer kept';

  -- dismiss, and the bulk no_match action
  perform resolve_review_item('66666666-0000-4000-8000-0000000000c6', 'dismiss');
  assert (select status from review_items where id = '66666666-0000-4000-8000-0000000000c6') = 'dismissed';
  assert create_people_for_no_match() = 1, 'bulk: wrong count';
  assert exists (select from person_emails where email = 'bulk-review@umich.edu'), 'bulk: person';

  -- a failure leaves nothing half-done
  begin
    perform resolve_review_item('66666666-0000-4000-8000-0000000000c6', 'merge', '66666666-0000-4000-8000-000000000001');
    raise exception 'merge without a second person succeeded';
  exception when raise_exception then
    assert sqlerrm = 'Merge needs two people.', sqlerrm;
  end;
end $$;

reset role;
\echo 'Review resolution checks passed.'
rollback;
