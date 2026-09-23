-- Run as postgres on a local migrated database; all fixtures roll back.
\set ON_ERROR_STOP on
begin;
insert into app_users (email, role) values ('matching-test@umich.edu', 'admin');
insert into people (id, first_name, last_name, uniqname, slack_user_id) values
  ('88888888-0000-4000-8000-000000000001', 'Nina', 'Kowalski', 'nkowal', 'UMATCH1'),
  ('88888888-0000-4000-8000-000000000002', 'Nina', 'Kowalski', null, null),
  ('88888888-0000-4000-8000-000000000003', 'Nina', 'Kowalski', null, null),
  ('88888888-0000-4000-8000-000000000004', 'Ryan', 'O''Connell Jr.', null, null),
  ('88888888-0000-4000-8000-000000000005', 'Ryan', 'O''Connell Sr.', null, null),
  ('88888888-0000-4000-8000-000000000006', 'José', 'García', null, null),
  ('88888888-0000-4000-8000-000000000007', 'Josè', 'García', null, null);
insert into person_emails (person_id, email, source) values
  ('88888888-0000-4000-8000-000000000001', 'nkowal@umich.edu', 'manual'),
  ('88888888-0000-4000-8000-000000000001', 'nina.other@gmail.com', 'manual'),
  ('88888888-0000-4000-8000-000000000002', 'nina2@gmail.com', 'manual'),
  ('88888888-0000-4000-8000-000000000004', 'ryanjr@gmail.com', 'manual'),
  ('88888888-0000-4000-8000-000000000005', 'ryansr@gmail.com', 'manual'),
  ('88888888-0000-4000-8000-000000000006', 'jose1@gmail.com', 'manual'),
  ('88888888-0000-4000-8000-000000000007', 'jose2@gmail.com', 'manual');

set local role authenticated;
select set_config('request.jwt.claims', '{"email":"matching-test@umich.edu","role":"authenticated"}', true);
do $$
declare m record; input_name text;
begin
  assert normalize_match_name(U&'Jose\0301 Garci\0301a') = normalize_match_name('José García'),
    'Canonical Unicode forms must agree';
  assert normalize_match_name(U&'Q\0301 Smith') <> normalize_match_name('Q Smith'),
    'Non-composing combining marks must not be dropped';
  assert normalize_match_name(U&'Nina\00A0Kowalski') = 'nina kowalski',
    'Nonbreaking spaces must normalize like the preview';
  select * into m from match_person('new@gmail.com', 'Nina Kowalski');
  assert m.person_id is null, 'Same name must never auto-link';
  assert jsonb_array_length(m.candidates) = 2, 'Review both exact names with emails, excluding the email-less person';
  assert m.confidence = 0.85 and m.candidates->0->>'reason' = 'name_exact_email_different', 'Duplicate review reason';

  foreach input_name in array array['Nina Kowalska', 'N. Kowalski', 'Nina J Kowalski', 'Nina Kowalski Jr.', null] loop
    select * into m from match_person('nkowal@umich.efu', input_name);
    assert m.person_id is null and m.candidates = '[]', 'Different name must not become a typo-domain suggestion';
  end loop;
  select * into m from match_person('nkowal@umich.efu', 'Nina Kowalski');
  assert jsonb_array_length(m.candidates) = 2, 'Same-name typo email qualifies through the same exact-name rule';
  select * into m from match_person(null, 'Nina Kowalski');
  assert m.candidates = '[]', 'A missing email is not a different email';
  select * into m from match_person('   ', 'Nina Kowalski');
  assert m.candidates = '[]', 'A blank email is not a different email';
  select * into m from match_person('new@gmail.com', '  RYAN   OCONNELL, JR ');
  assert jsonb_array_length(m.candidates) = 1 and m.candidates->0->>'person_id' = '88888888-0000-4000-8000-000000000004', 'Ignore formatting, preserve suffixes';
  select * into m from match_person('new@gmail.com', 'José García');
  assert jsonb_array_length(m.candidates) = 1 and m.candidates->0->>'person_id' = '88888888-0000-4000-8000-000000000006', 'Preserve accented letters';

  select * into m from match_person('N.KOWAL+tag@UMICH.EDU', 'Different Name');
  assert m.person_id = '88888888-0000-4000-8000-000000000001', 'Normalized email stays authoritative';
  select * into m from match_person('nina.other@gmail.com', 'Different Name');
  assert m.person_id = '88888888-0000-4000-8000-000000000001', 'All existing email aliases are checked';
  select * into m from match_person('new@gmail.com', null, 'nkowal');
  assert m.person_id = '88888888-0000-4000-8000-000000000001', 'Exact uniqname still auto-links';
  select * into m from match_person('new@gmail.com', null, null, 'UMATCH1');
  assert m.person_id = '88888888-0000-4000-8000-000000000001', 'Exact Slack id still auto-links';
  select * into m from match_person('nina2@gmail.com', 'Nina Kowalski', null, 'UMATCH1');
  assert m.person_id is null and jsonb_array_length(m.candidates) = 2, 'Conflicting identifiers must still require resolution';
end $$;

-- Exercise the commit path, not just the matcher: exact names queue, similar
-- names create separate people, and the staged row is retained for resolution.
insert into imports (id, source, kind) values
  ('88888888-0000-4000-8000-000000000010', 'manual_csv', 'people_bulk');
insert into import_rows (id, import_id, row_index, raw, parsed, row_hash) values
  ('88888888-0000-4000-8000-000000000011', '88888888-0000-4000-8000-000000000010', 1, '{}',
   '{"first_name":"Nina","last_name":"Kowalski","email":"incoming-exact@gmail.com"}', 'matching-test-exact'),
  ('88888888-0000-4000-8000-000000000012', '88888888-0000-4000-8000-000000000010', 2, '{}',
   '{"first_name":"Nina","last_name":"Kowalska","email":"nkowal@umich.efu"}', 'matching-test-similar');
do $$
declare result text; candidate_id uuid;
begin
  result := apply_import_row('88888888-0000-4000-8000-000000000011');
  assert result = 'review', 'Exact-name/different-email import must wait for review';
  assert exists (select from review_items
    where import_row_id = '88888888-0000-4000-8000-000000000011'
      and kind = 'ambiguous_match' and status = 'open' and jsonb_array_length(candidates) = 2),
    'Commit must queue the exact-name candidates as a duplicate suggestion';
  assert not exists (select from person_emails where email_normalized = 'incoming-exact@gmail.com'),
    'Duplicate suggestion must not link the incoming email before review';
  result := apply_import_row('88888888-0000-4000-8000-000000000012');
  assert result = 'new', 'Similar-name import must create a separate person';
  assert not exists (select from review_items where import_row_id = '88888888-0000-4000-8000-000000000012'),
    'Similar-name import must not generate review noise';
  select person_id into candidate_id from import_rows where id = '88888888-0000-4000-8000-000000000012';
  assert candidate_id is not null and candidate_id not in
    ('88888888-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000002'),
    'Similar-name import must not merge the people';
end $$;
reset role;
rollback;
\echo Exact-name/different-email SQL matching checks passed.
