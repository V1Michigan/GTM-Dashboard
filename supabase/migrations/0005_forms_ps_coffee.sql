-- Spec §4.4. import_id FKs are added in 0007 (imports is created after this file).

-- Raw answers stay in JSONB so a new form question never needs a migration.
create table form_submissions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) on delete set null,
  form_kind import_kind_t not null,
  tally_form_id text,
  tally_submission_id text unique,
  submitted_at timestamptz not null,
  answers jsonb not null default '{}',
  import_id uuid,
  created_at timestamptz not null default now()
);
create index form_submissions_person on form_submissions(person_id);

create table product_studio_applications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  semester semester_t not null,
  year int not null,
  round_reached ps_round_t not null default 'applied',
  outcome_notes text,
  tally_submission_id text unique,
  submitted_at timestamptz,
  import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, semester, year)
);

create table coffee_chats (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  member_id uuid not null references people(id) on delete cascade,
  chatted_on date,
  notes text,
  source import_source_t not null default 'manual',
  tally_submission_id text unique,
  logged_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (person_id, member_id, chatted_on)
);
create index coffee_chats_person on coffee_chats(person_id);
create index coffee_chats_member on coffee_chats(member_id);
