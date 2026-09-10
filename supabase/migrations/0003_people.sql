-- Spec §4.2. `people` has no email column; emails live in person_emails (§3.1).
create table people (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  -- Filled by a trigger in 0009 rather than `generated always as`: the
  -- expression calls normalize_name(), and a generated column would freeze that
  -- definition (Postgres forbids changing a function a stored column depends on).
  full_name_normalized text,
  uniqname citext unique,
  grad_year int check (grad_year between 2000 and 2100),
  grad_term grad_term_t,
  student_level student_level_t,
  major text,
  gender gender_t,
  is_v1_member boolean not null default false,
  member_since date,
  slack_user_id text unique,
  slack_joined_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index people_full_name_trgm on people using gin (full_name_normalized gin_trgm_ops);
create index people_is_v1_member on people(is_v1_member) where is_v1_member;

create table person_emails (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  email citext not null,
  email_normalized text not null unique,  -- filled by the trigger in 0009
  is_primary boolean not null default false,
  source import_source_t not null,
  created_at timestamptz not null default now()
);
create unique index one_primary_email_per_person on person_emails(person_id) where is_primary;

-- Empty in v1 (spec §11.4 fills it); the table exists so the schema does not change later.
create table person_organizations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  organization text not null,
  role text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (person_id, organization)
);
