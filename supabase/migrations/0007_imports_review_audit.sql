-- Spec §4.6, plus the wizard columns from §6 (/imports/new) and §4.8.
create table imports (
  id uuid primary key default gen_random_uuid(),
  source import_source_t not null,
  kind import_kind_t not null,
  event_id uuid references events(id) on delete set null,
  file_name text,
  file_hash text,
  storage_path text,
  column_mapping jsonb not null default '{}',
  status import_status_t not null default 'uploaded',
  row_count int,
  rows_new int, rows_updated int, rows_unchanged int, rows_review int, rows_failed int,
  error text,
  uploaded_by uuid references auth.users(id),
  -- Wizard choices (§6 step 1 and step 5). semester/year apply to
  -- product_studio_application, replace_roster to members_list.
  semester semester_t,
  year int,
  replace_roster boolean not null default false,
  incoming_wins boolean not null default false,
  allow_bad_rows boolean not null default false,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references imports(id) on delete cascade,
  row_index int not null,
  raw jsonb not null,
  parsed jsonb,
  row_hash text not null,
  person_id uuid references people(id) on delete set null,
  match_confidence numeric(3,2),
  status text not null default 'pending',   -- pending | applied | skipped_unchanged | review | failed
  error text,
  unique (import_id, row_index)
);
create index import_rows_hash on import_rows(row_hash);

create table review_items (
  id uuid primary key default gen_random_uuid(),
  kind review_kind_t not null,
  status review_status_t not null default 'open',
  import_row_id uuid references import_rows(id) on delete cascade,
  slack_user_id text,
  payload jsonb not null,
  candidates jsonb not null default '[]',
  resolution jsonb,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index review_items_open on review_items(status) where status = 'open';

create table person_merges (
  id uuid primary key default gen_random_uuid(),
  kept_id uuid not null,
  dropped_id uuid not null,
  dropped_snapshot jsonb not null,
  merged_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table field_changes (
  id bigserial primary key,
  table_name text not null,
  row_id uuid not null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  source import_source_t not null,
  import_id uuid references imports(id) on delete set null,
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
-- apply_import reads this to tell "value written earlier in *this* import" from
-- "value that existed before the import" (§4.8 duplicate-rows rule).
create index field_changes_row_field on field_changes(row_id, field, import_id);

-- Spec §6: the wizard remembers the mapping per (source, kind).
create table saved_column_mappings (
  source import_source_t not null,
  kind import_kind_t not null,
  mapping jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (source, kind)
);

-- Spec §6: every webhook route stores the raw payload here first, so deliveries
-- are replayable and debuggable.
create table webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  received_at timestamptz not null default now(),
  headers jsonb,
  payload jsonb,
  processed boolean not null default false,
  error text
);

-- Deferred FKs: these tables were created before `imports` existed (§4 note).
alter table event_attendance
  add constraint event_attendance_first_import_fkey foreign key (first_import_id) references imports(id) on delete set null,
  add constraint event_attendance_last_import_fkey  foreign key (last_import_id)  references imports(id) on delete set null;
alter table form_submissions
  add constraint form_submissions_import_fkey foreign key (import_id) references imports(id) on delete set null;
alter table product_studio_applications
  add constraint product_studio_applications_import_fkey foreign key (import_id) references imports(id) on delete set null;

-- One trigger function (0002), attached to every base table that has the column.
do $$
declare t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'updated_at'
      and tb.table_type = 'BASE TABLE'
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function set_updated_at()', t);
  end loop;
end $$;
