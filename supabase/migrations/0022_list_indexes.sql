-- Indexes the list pages have always needed. None of these change behaviour;
-- they remove sequential scans that grew with the tables.

-- people_list and people_directory (0008) read `primary_email` through a
-- correlated subquery per person:
--   select e.email from person_emails e where e.person_id = p.id
--     order by e.is_primary desc, e.created_at limit 1
-- The only index touching person_id was the PARTIAL unique
-- `one_primary_email_per_person ... where is_primary` (0003:36), which cannot
-- serve that ordered lookup. So the planner seq-scanned person_emails once per
-- person and /people cost people x emails, not people.
create index person_emails_person on person_emails(person_id);

-- events_list (0008) counts open review items per event through
-- review_items -> import_rows -> imports; getImport() takes the same path.
-- Neither join column was indexed.
create index review_items_import_row on review_items(import_row_id);
create index imports_event on imports(event_id);

-- The /people grad-year filter needs the distinct set, and PostgREST has no
-- DISTINCT. Fetching the column and deduping in JS would re-introduce exactly
-- the read-every-row pattern the pagination work removes; this returns ~10 rows.
create view people_grad_years with (security_invoker = true) as
select distinct grad_year from people where grad_year is not null;
