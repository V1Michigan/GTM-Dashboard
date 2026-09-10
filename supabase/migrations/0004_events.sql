-- Spec §4.3. Attendance lives only in event_attendance; counts come from the
-- views in 0008, never from an attendees array.
create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date not null,
  start_time time,
  end_time time,
  location text,
  event_type text,
  luma_event_id text unique,
  tally_checkin_form_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, event_date)
);

create table event_attendance (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  registered boolean not null default false,
  registered_at timestamptz,
  registration_source import_source_t,
  luma_approval_status text,
  luma_guest_id text,
  referral_source text,
  utm_source text,
  referred_by_email citext,
  checked_in boolean not null default false,
  checked_in_at timestamptz,
  checkin_source import_source_t,
  checkin_answers jsonb not null default '{}',
  -- FKs to imports(id) are added in 0007; imports is created after this file.
  first_import_id uuid,
  last_import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, person_id)
);
create index event_attendance_person on event_attendance(person_id);
