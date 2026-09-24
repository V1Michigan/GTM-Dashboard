-- V1 GTM dashboard schema. One baseline, squashed from migrations 0001-0025
-- on 2026-09-24; later changes go in new numbered files after this one.
-- Spec section references (§) point at the product spec.

/* ── Extensions ─────────────────────────────────────────────────────── */

-- Spec §4: pg_trgm (name similarity) and citext (emails/uniqnames).
--
-- Installed into `public` rather than Supabase's `extensions` schema so that the
-- security-definer functions below can pin `search_path = public, pg_temp` and
-- still resolve similarity(). A definer function with a mutable
-- search_path is a privilege-escalation hole; this is the trade.
create extension if not exists pg_trgm;
create extension if not exists citext;

/* ── Types ──────────────────────────────────────────────────────────── */

-- Spec §4.1. Enum order is load-bearing for ps_round_t: apply_import advances
-- round_reached with greatest(), which relies on declaration order.
create type gender_t as enum ('male','female','non_binary','prefer_not_to_say');
create type student_level_t as enum ('undergrad','graduate','other');
create type app_role_t as enum ('admin','member');
create type grad_term_t as enum ('winter','spring','summer','fall');
create type semester_t as enum ('winter','fall');
create type ps_round_t as enum ('applied','interview','accepted','completed','withdrew');
create type import_source_t as enum ('luma_csv','tally_csv','manual_csv','tally_webhook','luma_webhook','slack','manual');
create type import_kind_t as enum ('event_registration','event_checkin','interest_form','community_interest_form','product_studio_application','coffee_chat','members_list','people_bulk','slack_members');
create type import_status_t as enum ('uploaded','parsed','needs_review','committed','failed');
create type review_status_t as enum ('open','resolved','dismissed');
create type review_kind_t as enum ('no_match','ambiguous_match','conflict','field_conflict','bad_row');

-- The only updated_at trigger function in the schema; the Tables section attaches it to every
-- table that has the column.
create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

/* ── Tables ─────────────────────────────────────────────────────────── */

-- Spec §4.2. `people` has no email column; emails live in person_emails (§3.1).
create table people (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  -- Filled by a trigger (see Matching) rather than `generated always as`: the
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
  email_normalized text not null unique,  -- filled by a trigger (see Matching)
  is_primary boolean not null default false,
  source import_source_t not null,
  created_at timestamptz not null default now()
);
create unique index one_primary_email_per_person on person_emails(person_id) where is_primary;

-- Spec §4.3. Attendance lives only in event_attendance; counts come from the
-- views, never from an attendees array.
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
  -- FKs to imports(id) are added below, once imports exists.
  first_import_id uuid,
  last_import_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, person_id)
);
create index event_attendance_person on event_attendance(person_id);

-- Spec §4.4. import_id FKs are added below, once imports exists.

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

-- Spec §4.5. Message *contents* are never stored — only per-day counts.
create table slack_channels (
  id text primary key,
  name text not null,
  is_private boolean not null default false,
  is_archived boolean not null default false,
  bot_is_member boolean not null default false,
  last_synced_at timestamptz
);

create table slack_channel_activity (
  person_id uuid not null references people(id) on delete cascade,
  channel_id text not null references slack_channels(id),
  activity_date date not null,
  message_count int not null default 0,
  primary key (person_id, channel_id, activity_date)
);

create table slack_unmatched_users (
  slack_user_id text primary key,
  email citext,
  display_name text,
  real_name text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  pending_message_counts jsonb not null default '{}'
);

-- Spec §8.1: Slack retries on any non-2xx, so the events route dedupes on the
-- envelope event_id. Pruned by the daily scheduled function (§8.4).
create table slack_event_dedupe (
  event_id text primary key,
  received_at timestamptz not null default now()
);

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

-- One trigger function (see Types), attached to every base table that has the column.
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

-- Join columns the list views and getImport() read through.
create index person_emails_person on person_emails(person_id);
create index review_items_import_row on review_items(import_row_id);
create index imports_event on imports(event_id);

/* ── Matching ───────────────────────────────────────────────────────── */

-- Spec §3.2. This is the SQL side of the ladder; lib/matching/matchPerson.ts is
-- the TS mirror used for dry-run previews and must produce the same answers.

create function normalize_email(p_email text) returns text
language sql immutable as $$
  select case
    when nullif(btrim(coalesce(p_email, '')), '') is null then null
    -- umich addresses have no dots or +tags in the real uniqname; people type them anyway.
    when split_part(lower(btrim(p_email)), '@', 2) = 'umich.edu'
      then replace(split_part(split_part(lower(btrim(p_email)), '@', 1), '+', 1), '.', '') || '@umich.edu'
    else lower(btrim(p_email))
  end
$$;

create function normalize_name(p_name text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g'),
      '(^| )(jr|sr|ii|iii|iv)( |$)', ' ', 'g'),
    ' +', ' ', 'g')), '')
$$;

-- full_name_normalized / email_normalized are maintained here rather than as
-- generated columns: a stored generated column pins the function definition,
-- and both normalizers must stay editable in step with the TS mirror.
create function people_set_name_normalized() returns trigger language plpgsql as $$
begin
  new.full_name_normalized := normalize_name(concat_ws(' ', new.first_name, new.last_name));
  return new;
end $$;
create trigger set_full_name_normalized before insert or update of first_name, last_name
  on people for each row execute function people_set_name_normalized();

create function person_emails_set_normalized() returns trigger language plpgsql as $$
begin
  new.email_normalized := normalize_email(new.email::text);
  return new;
end $$;
create trigger set_email_normalized before insert or update of email
  on person_emails for each row execute function person_emails_set_normalized();

create function person_display(p_id uuid) returns text
language sql stable as $$
  select btrim(concat_ws(' ', p.first_name, p.last_name))
       || coalesce(' <' || (select e.email::text from person_emails e
                             where e.person_id = p.id
                             order by e.is_primary desc, e.created_at limit 1) || '>', '')
  from people p where p.id = p_id
$$;

-- One element of the MatchCandidate[] in lib/types.ts, or [] when p_id is null.
create function match_candidate(p_id uuid, p_confidence numeric, p_reason text) returns jsonb
language sql stable as $$
  select case when p_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
    'person_id', p_id, 'confidence', p_confidence,
    'reason', p_reason, 'display', coalesce(person_display(p_id), ''))) end
$$;

-- Duplicate review is an explicit rule: exact full name, different present
-- emails. Similar spellings and suspected email-domain typos are not sufficient.
-- Exact email/Slack/uniqname identifiers and identifier conflicts keep priority.
-- Keep the rule in sync with lib/matching/matchPerson.ts.

-- Unlike the general search normalizer, retain suffixes and Unicode letters.
-- Ignore common punctuation and repeated whitespace; never expand initials or
-- nicknames. NFC preserves canonical accents; translate preserves combining
-- marks that cannot be composed, unlike a broad non-letter regex.
create function normalize_match_name(p_name text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(
    translate(lower(normalize(coalesce(p_name, ''), NFC)),
      $punct$!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~‐‑‒–—―‘’‚‛“”„‟$punct$, ''),
    -- The same whitespace set as JavaScript's \s, including nonbreaking spaces.
    U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')), '')
$$;

create index people_exact_match_name on people (
  normalize_match_name(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
);

create or replace function match_person(
  p_email text default null,
  p_name text default null,
  p_uniqname text default null,
  p_slack_user_id text default null
) returns table (person_id uuid, confidence numeric, candidates jsonb)
language plpgsql stable as $$
declare
  v_email  text := normalize_email(p_email);
  v_name   text := normalize_match_name(p_name);
  v_uniq   text := lower(nullif(btrim(p_uniqname), ''));
  v_slack  text := nullif(btrim(p_slack_user_id), '');
  v_domain text := split_part(coalesce(v_email, ''), '@', 2);
  v_local  text := split_part(coalesce(v_email, ''), '@', 1);
  v_slack_id uuid; v_email_id uuid; v_uniq_id uuid;
  v_ids uuid[];
  v_cands jsonb := '[]'::jsonb;
begin
  if v_uniq is null and v_domain = 'umich.edu' then
    v_uniq := v_local;
  end if;

  if v_slack is not null then
    select p.id into v_slack_id from people p where p.slack_user_id = v_slack;
  end if;
  if v_email is not null then
    select pe.person_id into v_email_id from person_emails pe where pe.email_normalized = v_email;
  end if;
  if v_uniq is not null then
    -- explicit ::citext: citext = text would resolve to the case-sensitive text operator
    select p.id into v_uniq_id from people p where p.uniqname = v_uniq::citext;
  end if;

  v_cands := match_candidate(v_slack_id, 1.0, 'slack_user_id')
          || match_candidate(v_email_id, 1.0, 'email')
          || match_candidate(v_uniq_id, 0.95, 'uniqname');
  select array_agg(distinct x) into v_ids
    from unnest(array[v_slack_id, v_email_id, v_uniq_id]) x where x is not null;

  if coalesce(array_length(v_ids, 1), 0) > 1 then
    return query select null::uuid, 1.0::numeric, v_cands;   -- conflict
    return;
  elsif coalesce(array_length(v_ids, 1), 0) = 1 then
    return query select v_ids[1],
      case when v_slack_id is not null or v_email_id is not null then 1.0 else 0.95 end::numeric,
      v_cands;
    return;
  end if;

  if v_email is not null and v_name is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'person_id', p.id, 'confidence', 0.85,
      'reason', 'name_exact_email_different', 'display', person_display(p.id))
      order by p.id), '[]'::jsonb)
    into v_cands
    from people p
    where normalize_match_name(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) = v_name
      and exists (
        select 1 from person_emails pe
        where pe.person_id = p.id and nullif(btrim(pe.email_normalized), '') is not null
          and pe.email_normalized <> v_email
      );
    if jsonb_array_length(v_cands) > 0 then
      return query select null::uuid, 0.85::numeric, v_cands;
      return;
    end if;
  end if;

  return query select null::uuid, 1.0::numeric, '[]'::jsonb;
end $$;

/* ── Imports ────────────────────────────────────────────────────────── */

/*
 * Spec §4.8. This is the contract for merge semantics; the CSV importer and the
 * webhook handlers both go through it, so the rules live here and not in TS.
 *
 * Canonical field names apply_import_row reads out of import_rows.parsed
 * (the lib/imports parsers must emit these, already value-mapped per §4.9):
 *   email, name | first_name, last_name, uniqname, grad_year, grad_term,
 *   student_level, major, gender, member_since,
 *   registered, registered_at, luma_approval_status, luma_guest_id,
 *   referral_source, utm_source, referred_by_email,
 *   checked_in_at, checkin_answers (object),
 *   tally_form_id, tally_submission_id, submitted_at, answers (object),
 *   semester, year, round_reached, outcome_notes,
 *   member_email, member_name, chatted_on, notes
 */

-- §4.8: several CSV columns may map to one canonical field ("Grade", "Grade (2)");
-- the value is the first non-blank in column order. jsonb orders keys by length
-- then bytes, which puts "Grade" ahead of "Grade (2)" as the export intends.
create function map_row(p_raw jsonb, p_mapping jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(s.field, s.value), '{}'::jsonb)
  from (
    select distinct on (m.value #>> '{}') m.value #>> '{}' as field, r.value
    from jsonb_each(coalesce(p_mapping, '{}'::jsonb)) m
    join jsonb_each(coalesce(p_raw, '{}'::jsonb)) r on r.key = m.key
    where nullif(btrim(r.value #>> '{}'), '') is not null
    order by m.value #>> '{}', m.key
  ) s
$$;

-- §4.8 rule 4. Nulls never overwrite; equal values are a no-op; a different value
-- is refused and raised as a field_conflict unless the wizard said incoming wins
-- or the existing value was itself written earlier in this same import.
create function apply_person_fields(
  p_person uuid, p_fields jsonb, p_import uuid, p_import_row uuid,
  p_incoming_wins boolean, p_source import_source_t
) returns void language plpgsql as $$
declare
  v_cur jsonb; v_out jsonb := '{}'::jsonb;
  k text; v jsonb; v_old jsonb;
begin
  select to_jsonb(p) into v_cur from people p where p.id = p_person;
  for k, v in select key, value from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
    continue when jsonb_typeof(v) = 'null' or coalesce(btrim(v #>> '{}'), '') = '';
    v := to_jsonb(btrim(v #>> '{}'));
    v_old := v_cur -> k;
    if v_old is null or jsonb_typeof(v_old) = 'null' then
      v_out := v_out || jsonb_build_object(k, v);
    elsif (v_old #>> '{}') = (v #>> '{}') then
      continue;
    elsif p_incoming_wins
       or exists (select 1 from field_changes fc
                   where fc.row_id = p_person and fc.field = k and fc.import_id = p_import) then
      v_out := v_out || jsonb_build_object(k, v);
    else
      insert into review_items (kind, import_row_id, payload)
      values ('field_conflict', p_import_row, jsonb_build_object(
        'person_id', p_person, 'field', k, 'existing', v_old, 'incoming', v));
    end if;
  end loop;

  if v_out = '{}'::jsonb then return; end if;
  update people p set
    first_name      = coalesce(u.first_name, p.first_name),
    last_name       = coalesce(u.last_name, p.last_name),
    uniqname        = coalesce(u.uniqname, p.uniqname),
    grad_year       = coalesce(u.grad_year, p.grad_year),
    grad_term       = coalesce(u.grad_term, p.grad_term),
    student_level   = coalesce(u.student_level, p.student_level),
    major           = coalesce(u.major, p.major),
    gender          = coalesce(u.gender, p.gender),
    member_since    = coalesce(u.member_since, p.member_since),
    is_v1_member    = coalesce(u.is_v1_member, p.is_v1_member),
    notes           = coalesce(u.notes, p.notes),
    slack_user_id   = coalesce(u.slack_user_id, p.slack_user_id),
    slack_joined_at = coalesce(u.slack_joined_at, p.slack_joined_at)
  from jsonb_populate_record(null::people, v_out) u
  where p.id = p_person;

  insert into field_changes (table_name, row_id, field, old_value, new_value, source, import_id)
  select 'people', p_person, e.key, v_cur -> e.key, e.value, p_source, p_import
  from jsonb_each(v_out) e;
end $$;

/*
 * Applies one row. Returns 'new' | 'updated' | 'unchanged' | 'review'.
 * The review queue calls this after a human resolves an item: set
 * import_rows.person_id first and matching is skipped in favour of that choice.
 * Errors are raised, not swallowed — apply_import catches them per row.
 */

create function apply_import_row(
  p_import_row_id uuid,
  p_incoming_wins boolean default false,
  p_force_create boolean default false
)
returns text language plpgsql as $$
declare
  v_row import_rows; v_imp imports; v_p jsonb; v_match record;
  v_email text; v_name text; v_first text; v_last text; v_uniq text;
  v_person uuid; v_member uuid; v_created boolean := false; v_existed boolean := false;
begin
  select ir.* into v_row from import_rows ir where ir.id = p_import_row_id;
  if not found then raise exception 'import_row % not found', p_import_row_id; end if;
  select i.* into v_imp from imports i where i.id = v_row.import_id;

  v_p := coalesce(v_row.parsed, map_row(v_row.raw, v_imp.column_mapping));
  if v_row.parsed is null then
    update import_rows set parsed = v_p where id = v_row.id;
  end if;

  -- rule 1: an identical row already applied for the same (kind, event) is a no-op
  if exists (
    select 1 from import_rows ir join imports i on i.id = ir.import_id
    where ir.row_hash = v_row.row_hash and ir.id <> v_row.id and ir.status = 'applied'
      and i.kind = v_imp.kind and i.event_id is not distinct from v_imp.event_id
  ) then
    update import_rows set status = 'skipped_unchanged', error = null where id = v_row.id;
    return 'unchanged';
  end if;

  v_email := nullif(btrim(v_p ->> 'email'), '');
  v_name  := nullif(btrim(v_p ->> 'name'), '');
  v_first := coalesce(nullif(btrim(v_p ->> 'first_name'), ''),
                      nullif(substring(v_name from '^(.*) \S+$'), ''), v_name);
  v_last  := coalesce(nullif(btrim(v_p ->> 'last_name'), ''),
                      nullif(substring(v_name from ' (\S+)$'), ''));
  v_name  := coalesce(v_name, concat_ws(' ', v_first, v_last));
  v_uniq  := coalesce(nullif(btrim(v_p ->> 'uniqname'), ''),
                      case when split_part(coalesce(normalize_email(v_email), ''), '@', 2) = 'umich.edu'
                           then split_part(normalize_email(v_email), '@', 1) end);

  -- §8.4 syncs only non-bot, non-deleted users, and this is the CSV equivalent.
  -- Checked before matching so no person row is ever created for a bot.
  if v_imp.kind = 'slack_members' and (
       lower(coalesce(v_p ->> 'slack_status', '')) in ('bot', 'deactivated')
       or split_part(lower(coalesce(v_email, '')), '@', 2) = 'slack-bots.com') then
    update import_rows set status = 'skipped_unchanged', error = null where id = v_row.id;
    return 'unchanged';
  end if;

  -- §4.8 test rows. The wizard's "import anyway" toggle is imports.allow_bad_rows;
  -- a row whose person_id a human already chose in /review is past this check.
  if not v_imp.allow_bad_rows and v_row.person_id is null and (
       split_part(lower(coalesce(v_email, '')), '@', 2) ~ '^test\.'
       or lower(split_part(coalesce(v_email, ''), '@', 1)) = 'test'
       or normalize_name(v_name) = 'test') then
    insert into review_items (kind, import_row_id, payload) values ('bad_row', v_row.id, v_p);
    update import_rows set status = 'review' where id = v_row.id;
    return 'review';
  end if;

  -- rule 2
  v_person := v_row.person_id;
  -- A human resolving a review item as "create a new person" has already made
  -- the decision the ladder would re-litigate. Without this the resolver re-runs
  -- match_person, hits the same ambiguity, and raises a fresh review item — the
  -- resolved row reappears at the bottom of the queue instead of leaving it.
  if v_person is null and p_force_create then
    insert into people default values returning id into v_person;
    v_created := true;
  elsif v_person is null then
    select * into v_match
      from match_person(v_email, v_name, v_uniq, nullif(v_p ->> 'slack_user_id', ''));
    if v_match.person_id is not null then
      v_person := v_match.person_id;
    elsif jsonb_array_length(v_match.candidates) = 0 then
      insert into people default values returning id into v_person;
      v_created := true;
    else
      -- Re-running a row that is already queued must not queue it twice.
      insert into review_items (kind, import_row_id, payload, candidates)
      select
        case when (select count(*) from jsonb_array_elements(v_match.candidates) c
                    where (c ->> 'confidence')::numeric >= 0.9) > 1
             then 'conflict'::review_kind_t else 'ambiguous_match'::review_kind_t end,
        v_row.id, v_p, v_match.candidates
      where not exists (
        select 1 from review_items rv
        where rv.import_row_id = v_row.id and rv.status = 'open');
      update import_rows set status = 'review', match_confidence = v_match.confidence
       where id = v_row.id;
      return 'review';
    end if;
  end if;

  -- rule 5: every email seen for a matched person is kept, non-primary unless it is the first
  if v_email is not null then
    insert into person_emails (person_id, email, is_primary, source)
    values (v_person, v_email::citext,
            not exists (select 1 from person_emails pe where pe.person_id = v_person and pe.is_primary),
            v_imp.source)
    on conflict (email_normalized) do nothing;
  end if;

  -- rule 4
  perform apply_person_fields(v_person, jsonb_strip_nulls(jsonb_build_object(
    'first_name', v_first, 'last_name', v_last, 'uniqname', v_uniq,
    'grad_year', v_p ->> 'grad_year', 'grad_term', v_p ->> 'grad_term',
    'student_level', v_p ->> 'student_level', 'major', v_p ->> 'major',
    'gender', v_p ->> 'gender'
  )), v_imp.id, v_row.id, p_incoming_wins, v_imp.source);

  -- rule 3: the target row for this import kind
  if v_imp.kind in ('event_registration', 'event_checkin') and v_imp.event_id is null then
    raise exception 'import % is % but has no event_id', v_imp.id, v_imp.kind;
  end if;
  select exists (select 1 from event_attendance a
                  where a.event_id = v_imp.event_id and a.person_id = v_person) into v_existed;

  if v_imp.kind = 'event_registration' then
    insert into event_attendance (
      event_id, person_id, registered, registered_at, registration_source,
      luma_approval_status, luma_guest_id, referral_source, utm_source, referred_by_email,
      first_import_id, last_import_id)
    values (
      v_imp.event_id, v_person, coalesce((v_p ->> 'registered')::boolean, true),
      nullif(v_p ->> 'registered_at', '')::timestamptz, v_imp.source,
      nullif(v_p ->> 'luma_approval_status', ''), nullif(v_p ->> 'luma_guest_id', ''),
      nullif(v_p ->> 'referral_source', ''), nullif(v_p ->> 'utm_source', ''),
      nullif(v_p ->> 'referred_by_email', '')::citext, v_imp.id, v_imp.id)
    on conflict (event_id, person_id) do update set
      -- incoming wins so a later "declined" can un-register; §4.9 maps approval_status
      registered           = excluded.registered,
      registered_at        = coalesce(event_attendance.registered_at, excluded.registered_at),
      registration_source  = excluded.registration_source,
      luma_approval_status = coalesce(excluded.luma_approval_status, event_attendance.luma_approval_status),
      luma_guest_id        = coalesce(excluded.luma_guest_id, event_attendance.luma_guest_id),
      referral_source      = coalesce(event_attendance.referral_source, excluded.referral_source),
      utm_source           = coalesce(event_attendance.utm_source, excluded.utm_source),
      referred_by_email    = coalesce(event_attendance.referred_by_email, excluded.referred_by_email),
      first_import_id      = coalesce(event_attendance.first_import_id, excluded.first_import_id),
      last_import_id       = excluded.last_import_id;
      -- checked_in is never written by a registration import

  elsif v_imp.kind = 'event_checkin' then
    insert into event_attendance (
      event_id, person_id, registered, checked_in, checked_in_at, checkin_source,
      checkin_answers, referral_source, first_import_id, last_import_id)
    values (
      v_imp.event_id, v_person, false, true,
      nullif(v_p ->> 'checked_in_at', '')::timestamptz, v_imp.source,
      coalesce(v_p -> 'checkin_answers', '{}'::jsonb), nullif(v_p ->> 'referral_source', ''),
      v_imp.id, v_imp.id)
    on conflict (event_id, person_id) do update set
      checked_in      = true,
      checked_in_at   = coalesce(event_attendance.checked_in_at, excluded.checked_in_at),
      checkin_source  = excluded.checkin_source,
      checkin_answers = event_attendance.checkin_answers || excluded.checkin_answers,
      referral_source = coalesce(event_attendance.referral_source, excluded.referral_source),
      first_import_id = coalesce(event_attendance.first_import_id, excluded.first_import_id),
      last_import_id  = excluded.last_import_id;

  elsif v_imp.kind in ('interest_form', 'community_interest_form') then
    select exists (select 1 from form_submissions f
                    where f.tally_submission_id = nullif(v_p ->> 'tally_submission_id', ''))
      into v_existed;
    insert into form_submissions (
      person_id, form_kind, tally_form_id, tally_submission_id, submitted_at, answers, import_id)
    values (
      v_person, v_imp.kind, nullif(v_p ->> 'tally_form_id', ''),
      nullif(v_p ->> 'tally_submission_id', ''),
      coalesce(nullif(v_p ->> 'submitted_at', '')::timestamptz, now()),
      coalesce(v_p -> 'answers', '{}'::jsonb), v_imp.id)
    on conflict (tally_submission_id) do nothing;

  elsif v_imp.kind = 'product_studio_application' then
    select exists (select 1 from product_studio_applications a
                    where a.person_id = v_person
                      and a.semester = coalesce((nullif(v_p ->> 'semester', ''))::semester_t, v_imp.semester)
                      and a.year = coalesce((nullif(v_p ->> 'year', ''))::int, v_imp.year))
      into v_existed;
    insert into product_studio_applications (
      person_id, semester, year, round_reached, outcome_notes,
      tally_submission_id, submitted_at, import_id)
    values (
      v_person,
      coalesce((nullif(v_p ->> 'semester', ''))::semester_t, v_imp.semester),
      coalesce((nullif(v_p ->> 'year', ''))::int, v_imp.year),
      coalesce((nullif(v_p ->> 'round_reached', ''))::ps_round_t, 'applied'),
      nullif(v_p ->> 'outcome_notes', ''), nullif(v_p ->> 'tally_submission_id', ''),
      nullif(v_p ->> 'submitted_at', '')::timestamptz, v_imp.id)
    on conflict (person_id, semester, year) do update set
      -- enum declaration order is the round order; it only moves forward unless
      -- the wizard's "incoming values win" was checked (spec's allow_regress flag)
      round_reached = case when v_imp.incoming_wins then excluded.round_reached
                           else greatest(product_studio_applications.round_reached, excluded.round_reached) end,
      outcome_notes = coalesce(excluded.outcome_notes, product_studio_applications.outcome_notes),
      submitted_at  = coalesce(product_studio_applications.submitted_at, excluded.submitted_at),
      import_id     = excluded.import_id;

  elsif v_imp.kind = 'coffee_chat' then
    select m.person_id into v_member
      from match_person(nullif(v_p ->> 'member_email', ''), nullif(v_p ->> 'member_name', '')) m;
    if v_member is null then
      insert into review_items (kind, import_row_id, payload)
      values ('no_match', v_row.id, jsonb_build_object('member_lookup', v_p));
      update import_rows set status = 'review' where id = v_row.id;
      return 'review';
    end if;
    select exists (select 1 from coffee_chats c
                    where c.person_id = v_person and c.member_id = v_member
                      and c.chatted_on is not distinct from nullif(v_p ->> 'chatted_on', '')::date)
      into v_existed;
    insert into coffee_chats (person_id, member_id, chatted_on, notes, source, tally_submission_id)
    values (v_person, v_member, nullif(v_p ->> 'chatted_on', '')::date,
            nullif(v_p ->> 'notes', ''), v_imp.source, nullif(v_p ->> 'tally_submission_id', ''))
    on conflict (person_id, member_id, chatted_on) do nothing;

  elsif v_imp.kind = 'slack_members' then
    -- The export carries no join date, so slack_joined_at records "first seen in
    -- a Slack sync" and is never overwritten once set. slack_user_id likewise
    -- only fills a blank: a person already linked to a different Slack account
    -- is a conflict for a human, not something to silently repoint.
    v_existed := (select p.slack_user_id is not null from people p where p.id = v_person);
    update people p set
      slack_user_id   = coalesce(p.slack_user_id, nullif(v_p ->> 'slack_user_id', '')),
      slack_joined_at = coalesce(p.slack_joined_at, now())
    where p.id = v_person;

    if not v_existed then
      insert into field_changes (table_name, row_id, field, old_value, new_value, source, import_id)
      values ('people', v_person, 'slack_user_id', 'null'::jsonb,
              to_jsonb(v_p ->> 'slack_user_id'), v_imp.source, v_imp.id);
    end if;
    v_existed := not v_created;

  elsif v_imp.kind = 'members_list' then
    -- member_since is coalesce(existing, incoming, import date) rather than a
    -- field_conflict: on a roster the existing date is the authority (§4.8).
    v_existed := (select p.is_v1_member from people p where p.id = v_person);
    update people p set
      is_v1_member = true,
      member_since = coalesce(p.member_since, nullif(v_p ->> 'member_since', '')::date, v_imp.created_at::date)
    where p.id = v_person and (not p.is_v1_member or p.member_since is null);
    if not v_existed then
      insert into field_changes (table_name, row_id, field, old_value, new_value, source, import_id)
      values ('people', v_person, 'is_v1_member', 'false'::jsonb, 'true'::jsonb, v_imp.source, v_imp.id);
    end if;
    v_existed := not v_created;
  else
    v_existed := not v_created;      -- people_bulk: the person row is the target
  end if;

  update import_rows set status = 'applied', person_id = v_person, error = null,
    match_confidence = coalesce(match_confidence, case when v_created then 1.0 else null end)
  where id = v_row.id;

  -- rule 6: nothing is ever deleted by an import
  return case when v_created or not v_existed then 'new' else 'updated' end;
end $$;

/*
 * Committing a 531-row import timed out in production while the same work took
 * 66ms locally as a superuser. The difference is RLS: these functions ran with
 * the caller's privileges, so every statement inside the row loop re-evaluated
 * the admin policy on every table it touched, each evaluation calling
 * current_app_role(). Measured on identical data: 100 rows took 66ms as
 * superuser and 1,625ms as an authenticated admin, and 200 rows took 3.4s —
 * over Supabase's statement_timeout once production's slower compute is added.
 *
 * The import machinery is trusted server-side logic (§4.8 puts the merge rules
 * in SQL precisely so both the CSV importer and the webhooks share them), so it
 * now checks the caller is an admin once and runs as definer. apply_import_row
 * is deliberately NOT definer: it inherits definer rights when called from
 * apply_import_chunk, and stays RLS-bound when a client calls it directly to
 * resolve a single review item, where the per-row cost does not matter.
 */
create or replace function apply_import_chunk(p_import_id uuid, p_limit int default 200)
returns int language plpgsql security definer
 set search_path = public, pg_temp as $$
declare
  v_imp imports; r record; v_res text; v_done int := 0;
begin
  -- SECURITY DEFINER, so the caller is checked once here instead of RLS being
  -- re-evaluated for every statement of every row.
  --
  -- The check reads the JWT role claim, NOT current_user/session_user: inside a
  -- definer function both of those are the function's owner, so a check on them
  -- passes for everyone — including anon. The claim is set by PostgREST from the
  -- caller's key and is unaffected by the definer switch. anon carries no claims
  -- at all, hence the nullif before the cast.
  -- coalesce is load-bearing: current_app_role() is NULL for anon and for any
  -- caller with no app_users row, and `NULL = 'admin'` is NULL, so `if not (...)`
  -- would be NULL and the raise would never fire — the guard would pass silently
  -- for exactly the callers it exists to stop.
  if not coalesce(
    public.current_app_role()::text = 'admin'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
       = 'service_role'
    -- direct superuser access (psql, migrations); PostgREST connects as
    -- `authenticator`, so this arm never fires for an API caller
    or session_user in ('postgres', 'supabase_admin')
  , false) then
    raise exception 'this import function is restricted to admins';
  end if;

  select i.* into v_imp from imports i where i.id = p_import_id;
  if not found then raise exception 'import % not found', p_import_id; end if;

  for r in
    select ir.id from import_rows ir
    -- 'review' rows are included so a row the dry run could not match still gets
    -- a review_items entry — without that they are invisible in /review forever.
    -- But only until it HAS one: a review row keeps its status, so re-selecting
    -- it every chunk would loop until the guard trips.
    where ir.import_id = p_import_id
      and (ir.status = 'pending'
           or (ir.status = 'review' and not exists (
                 select 1 from review_items rv
                 where rv.import_row_id = ir.id and rv.status = 'open')))
    -- §4.8: duplicates of one person inside one import go oldest-first so the
    -- later row fills fields instead of conflicting. Ordered as text on purpose:
    -- a bad timestamp in one row must not abort the whole import.
    order by nullif(ir.parsed ->> 'submitted_at', '') nulls first, ir.row_index
    limit p_limit
  loop
    begin
      v_res := apply_import_row(r.id, v_imp.incoming_wins);
      v_done := v_done + 1;
    exception when others then
      update import_rows set status = 'failed', error = sqlerrm where id = r.id;
    end;
  end loop;


  return v_done;
end $$;

create or replace function finalize_import(p_import_id uuid) returns void
language plpgsql security definer
 set search_path = public, pg_temp as $$
declare
  v_imp imports;
begin
  -- SECURITY DEFINER, so the caller is checked once here instead of RLS being
  -- re-evaluated for every statement of every row.
  --
  -- The check reads the JWT role claim, NOT current_user/session_user: inside a
  -- definer function both of those are the function's owner, so a check on them
  -- passes for everyone — including anon. The claim is set by PostgREST from the
  -- caller's key and is unaffected by the definer switch. anon carries no claims
  -- at all, hence the nullif before the cast.
  -- coalesce is load-bearing: current_app_role() is NULL for anon and for any
  -- caller with no app_users row, and `NULL = 'admin'` is NULL, so `if not (...)`
  -- would be NULL and the raise would never fire — the guard would pass silently
  -- for exactly the callers it exists to stop.
  if not coalesce(
    public.current_app_role()::text = 'admin'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
       = 'service_role'
    -- direct superuser access (psql, migrations); PostgREST connects as
    -- `authenticator`, so this arm never fires for an API caller
    or session_user in ('postgres', 'supabase_admin')
  , false) then
    raise exception 'this import function is restricted to admins';
  end if;

  select i.* into v_imp from imports i where i.id = p_import_id for update;
  if not found then raise exception 'import % not found', p_import_id; end if;
  if v_imp.kind = 'members_list' and v_imp.replace_roster then
    -- Absence is meaningful only on a roster. Unmark; never delete.
    with dropped as (
      update people p set is_v1_member = false
      where p.is_v1_member
        and not exists (select 1 from import_rows ir
                        where ir.import_id = p_import_id and ir.person_id = p.id)
      returning p.id
    )
    insert into field_changes (table_name, row_id, field, old_value, new_value, source, import_id)
    select 'people', d.id, 'is_v1_member', 'true'::jsonb, 'false'::jsonb, v_imp.source, v_imp.id
    from dropped d;
  end if;

  update imports i set
    row_count      = (select count(*) from import_rows ir where ir.import_id = p_import_id),
    rows_new       = (select count(*) from import_rows ir where ir.import_id = p_import_id and ir.status = 'applied' and ir.person_id is not null),
    rows_updated   = 0,
    rows_unchanged = (select count(*) from import_rows ir where ir.import_id = p_import_id and ir.status = 'skipped_unchanged'),
    rows_review    = (select count(*) from import_rows ir where ir.import_id = p_import_id and ir.status = 'review'),
    rows_failed    = (select count(*) from import_rows ir where ir.import_id = p_import_id and ir.status = 'failed'),
    status = case when exists (
                    select 1 from review_items rv join import_rows ir on ir.id = rv.import_row_id
                    where ir.import_id = p_import_id and rv.status = 'open')
                  then 'needs_review'::import_status_t else 'committed'::import_status_t end,
    committed_at = now()
  where i.id = p_import_id;
end $$;

create or replace function apply_import(p_import_id uuid) returns void
language plpgsql security definer
 set search_path = public, pg_temp as $$
begin
  -- SECURITY DEFINER, so the caller is checked once here instead of RLS being
  -- re-evaluated for every statement of every row.
  --
  -- The check reads the JWT role claim, NOT current_user/session_user: inside a
  -- definer function both of those are the function's owner, so a check on them
  -- passes for everyone — including anon. The claim is set by PostgREST from the
  -- caller's key and is unaffected by the definer switch. anon carries no claims
  -- at all, hence the nullif before the cast.
  -- coalesce is load-bearing: current_app_role() is NULL for anon and for any
  -- caller with no app_users row, and `NULL = 'admin'` is NULL, so `if not (...)`
  -- would be NULL and the raise would never fire — the guard would pass silently
  -- for exactly the callers it exists to stop.
  if not coalesce(
    public.current_app_role()::text = 'admin'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
       = 'service_role'
    -- direct superuser access (psql, migrations); PostgREST connects as
    -- `authenticator`, so this arm never fires for an API caller
    or session_user in ('postgres', 'supabase_admin')
  , false) then
    raise exception 'this import function is restricted to admins';
  end if;

  while apply_import_chunk(p_import_id, 500) > 0 loop end loop;
  perform finalize_import(p_import_id);
end $$;

revoke execute on function apply_import_chunk(uuid, int) from anon;
revoke execute on function finalize_import(uuid) from anon;
revoke execute on function apply_import(uuid) from anon;

/* ── Merge and member actions ───────────────────────────────────────── */

/*
 * Spec §3.3. Reassigns every FK from drop_id to keep_id, unions the emails,
 * keeps non-null values from keep and fills its nulls from drop, writes a full
 * snapshot to person_merges, then deletes drop. One transaction (the caller's).
 *
 * The unique constraints ((event_id, person_id) and friends) are handled with a
 * `not exists` guard, the UPDATE equivalent of ON CONFLICT DO NOTHING: the losing
 * duplicate stays on drop_id and disappears with the cascading delete.
 */

create function merge_people(keep_id uuid, drop_id uuid) returns void
language plpgsql as $$
declare v_drop people;
begin
  if keep_id = drop_id then raise exception 'cannot merge a person into itself'; end if;
  select p.* into v_drop from people p where p.id = drop_id;
  if not found then raise exception 'person % not found', drop_id; end if;
  if not exists (select 1 from people p where p.id = keep_id) then
    raise exception 'person % not found', keep_id;
  end if;

  insert into person_merges (kept_id, dropped_id, dropped_snapshot, merged_by)
  values (keep_id, drop_id,
    jsonb_build_object(
      'person', to_jsonb(v_drop),
      'emails', coalesce((select jsonb_agg(to_jsonb(e)) from person_emails e where e.person_id = drop_id), '[]'::jsonb)),
    auth.uid());

  -- keep's primary email stays primary
  update person_emails set person_id = keep_id, is_primary = false where person_id = drop_id;
  update person_emails e set is_primary = true
   where e.person_id = keep_id
     and not exists (select 1 from person_emails x where x.person_id = keep_id and x.is_primary)
     and e.id = (select x.id from person_emails x where x.person_id = keep_id order by x.created_at limit 1);

  update event_attendance a set person_id = keep_id where a.person_id = drop_id
    and not exists (select 1 from event_attendance x
                    where x.person_id = keep_id and x.event_id = a.event_id);
  update product_studio_applications s set person_id = keep_id where s.person_id = drop_id
    and not exists (select 1 from product_studio_applications x
                    where x.person_id = keep_id and x.semester = s.semester and x.year = s.year);
  update coffee_chats c set person_id = keep_id where c.person_id = drop_id
    and not exists (select 1 from coffee_chats x where x.person_id = keep_id
                      and x.member_id = c.member_id and x.chatted_on is not distinct from c.chatted_on);
  update coffee_chats c set member_id = keep_id where c.member_id = drop_id
    and not exists (select 1 from coffee_chats x where x.member_id = keep_id
                      and x.person_id = c.person_id and x.chatted_on is not distinct from c.chatted_on);
  -- counts are additive, so the duplicate day is summed rather than dropped
  insert into slack_channel_activity (person_id, channel_id, activity_date, message_count)
  select keep_id, a.channel_id, a.activity_date, a.message_count
    from slack_channel_activity a where a.person_id = drop_id
  on conflict (person_id, channel_id, activity_date)
    do update set message_count = slack_channel_activity.message_count + excluded.message_count;

  update form_submissions set person_id = keep_id where person_id = drop_id;
  update import_rows     set person_id = keep_id where person_id = drop_id;
  update app_users       set person_id = keep_id where person_id = drop_id;
  update field_changes   set row_id    = keep_id where row_id = drop_id and table_name = 'people';

  delete from people where id = drop_id;   -- cascades the losing duplicates

  -- after the delete: uniqname and slack_user_id are unique
  update people p set
    first_name      = coalesce(p.first_name, v_drop.first_name),
    last_name       = coalesce(p.last_name, v_drop.last_name),
    uniqname        = coalesce(p.uniqname, v_drop.uniqname),
    grad_year       = coalesce(p.grad_year, v_drop.grad_year),
    grad_term       = coalesce(p.grad_term, v_drop.grad_term),
    student_level   = coalesce(p.student_level, v_drop.student_level),
    major           = coalesce(p.major, v_drop.major),
    gender          = coalesce(p.gender, v_drop.gender),
    is_v1_member    = p.is_v1_member or v_drop.is_v1_member,
    member_since    = least(p.member_since, v_drop.member_since),
    slack_user_id   = coalesce(p.slack_user_id, v_drop.slack_user_id),
    slack_joined_at = coalesce(p.slack_joined_at, v_drop.slack_joined_at),
    notes           = coalesce(p.notes, v_drop.notes)
  where p.id = keep_id;
end $$;

/*
 * Spec §4.7. The only write path a `member` has. Security definer because
 * members have no insert policy on people; execute is granted to authenticated
 * only (see Auth), and authenticated already means allowlisted by the auth trigger.
 */
create function member_log_coffee_chat(
  person_email text, person_name text, chatted_on date default null, notes text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member uuid := current_person_id();
  v_match record; v_person uuid; v_chat uuid;
begin
  if v_member is null then
    raise exception 'no V1 person record is linked to this account';
  end if;
  if nullif(btrim(coalesce(person_email, '')), '') is null then
    raise exception 'an email is required';
  end if;

  select * into v_match from match_person(person_email, person_name);
  v_person := v_match.person_id;
  if v_person is null then
    insert into people (first_name, last_name) values (
      coalesce(nullif(substring(person_name from '^(.*) \S+$'), ''), nullif(btrim(person_name), '')),
      nullif(substring(person_name from ' (\S+)$'), ''))
    returning id into v_person;
    insert into person_emails (person_id, email, is_primary, source)
    values (v_person, person_email::citext, true, 'manual')
    on conflict (email_normalized) do nothing;
    -- an admin confirms (or merges) the person this created
    insert into review_items (kind, payload, candidates)
    values ('no_match', jsonb_build_object(
      'created_person_id', v_person, 'email', person_email, 'name', person_name,
      'logged_by_member_id', v_member, 'source', 'member_log_coffee_chat'), v_match.candidates);
  end if;

  insert into coffee_chats (person_id, member_id, chatted_on, notes, source, logged_by)
  values (v_person, v_member, coalesce(chatted_on, current_date), nullif(btrim(coalesce(notes, '')), ''),
          'manual', auth.uid())
  on conflict (person_id, member_id, chatted_on) do update set notes = coalesce(excluded.notes, coffee_chats.notes)
  returning id into v_chat;
  return v_chat;
end $$;

/* ── Views ──────────────────────────────────────────────────────────── */

-- Every count the dashboard shows comes from here (spec §4.3, §6).
-- security_invoker = true so the reader's RLS still applies through the view;
-- people_directory is the one deliberate exception, see below.

-- Spec §4.7: the only people data a `member` may read. This view is
-- security_definer (the default) on purpose — it is the column-narrowed
-- projection that lets members read names/emails without a select policy on
-- `people`, which would expose gender, grad year, notes and Slack ids.
create view people_directory as
select p.id, p.first_name, p.last_name,
  (select e.email::text from person_emails e
    where e.person_id = p.id order by e.is_primary desc, e.created_at limit 1) as primary_email,
  p.is_v1_member
from people p;

create view events_list with (security_invoker = true) as
select e.*,
  count(a.id) filter (where a.registered)::int as registered_count,
  count(a.id) filter (where a.checked_in)::int as checked_in_count,
  count(a.id) filter (where a.checked_in and not a.registered)::int as walk_in_count,
  count(a.id) filter (where a.checked_in and p.is_v1_member)::int as member_checkin_count,
  (select count(*)::int
     from review_items ri
     join import_rows ir on ir.id = ri.import_row_id
     join imports i on i.id = ir.import_id
    where i.event_id = e.id and ri.status = 'open') as open_review_items
from events e
left join event_attendance a on a.event_id = e.id
left join people p on p.id = a.person_id
group by e.id;

create view people_list with (security_invoker = true) as
select p.*,
  (select e.email::text from person_emails e
    where e.person_id = p.id order by e.is_primary desc, e.created_at limit 1) as primary_email,
  (select count(*)::int from person_emails e where e.person_id = p.id) as email_count,
  (select count(*)::int from event_attendance a where a.person_id = p.id and a.registered) as events_registered,
  (select count(*)::int from event_attendance a where a.person_id = p.id and a.checked_in) as events_attended,
  (select count(*)::int from product_studio_applications a where a.person_id = p.id) as ps_applications,
  (select count(*)::int from coffee_chats c where c.person_id = p.id) as coffee_chats
from people p;

create view slack_channel_stats with (security_invoker = true) as
select c.*,
  count(distinct a.person_id)::int as active_people,
  coalesce(sum(a.message_count) filter (where a.activity_date > current_date - 7), 0)::int as messages_7d,
  coalesce(sum(a.message_count) filter (where a.activity_date > current_date - 30), 0)::int as messages_30d,
  coalesce(sum(a.message_count), 0)::int as messages_all
from slack_channels c
left join slack_channel_activity a on a.channel_id = c.id
group by c.id;

-- One row. "This semester" = the current academic term: Jan–Jul is that year's
-- winter/spring, Aug–Dec is that year's fall.
create view overview_stats with (security_invoker = true) as
with term as (
  select case when extract(month from current_date) < 8
              then make_date(extract(year from current_date)::int, 1, 1)
              else make_date(extract(year from current_date)::int, 8, 1) end as starts,
         case when extract(month from current_date) < 8
              then make_date(extract(year from current_date)::int, 8, 1)
              else make_date(extract(year from current_date)::int + 1, 1, 1) end as ends
)
select
  (select count(*)::int from people) as total_people,
  (select count(*)::int from people where is_v1_member) as members,
  (select count(*)::int from people where slack_joined_at is not null) as in_slack,
  (select count(*)::int from events e, term t
    where e.event_date >= t.starts and e.event_date < t.ends) as events_this_semester,
  (select count(*)::int from review_items where status = 'open') as open_review_items;

-- The /people grad-year filter needs the distinct set, and PostgREST has no
-- DISTINCT. Fetching the column and deduping in JS would re-introduce exactly
-- the read-every-row pattern the pagination work removes; this returns ~10 rows.
create view people_grad_years with (security_invoker = true) as
select distinct grad_year from people where grad_year is not null;

/* ── Auth and RLS ───────────────────────────────────────────────────── */

-- Spec §4.7 and §5. Two roles: admin (the dashboard) and member (coffee chats only).
create table app_users (
  email citext primary key,
  role app_role_t not null default 'member',
  person_id uuid references people(id) on delete set null,
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ::citext on both: citext = text resolves to the case-sensitive text operator.
create function current_app_role() returns app_role_t
language sql stable security definer set search_path = public, pg_temp as
  $$ select role from app_users where email = auth.email()::citext $$;

create function current_person_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as
  $$ select person_id from app_users where email = auth.email()::citext $$;

/*
 * Who may sign in: a umich account that is either on the allowlist or belongs to
 * a current V1 member. `hd=umich.edu` on the OAuth call is only a hint — this
 * trigger is the enforcement.
 */
create function auth_user_allowed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email is null or lower(new.email) not like '%@umich.edu' then
    raise exception 'Only @umich.edu accounts may sign in';
  end if;
  if not exists (select 1 from app_users a where a.email = new.email::citext)
     and not exists (select 1 from person_emails pe join people p on p.id = pe.person_id
                     where pe.email_normalized = normalize_email(new.email) and p.is_v1_member) then
    raise exception 'Account % is not on the V1 allowlist', new.email;
  end if;
  return new;
end $$;
create trigger check_v1_allowlist before insert on auth.users
  for each row execute function auth_user_allowed();

-- A V1 member who got past the check but is not on the allowlist becomes a
-- `member` linked to their person row.
create function auth_user_provision() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into app_users (email, role, person_id)
  select new.email::citext, 'member', p.id
    from person_emails pe join people p on p.id = pe.person_id
   where pe.email_normalized = normalize_email(new.email) and p.is_v1_member
   limit 1
  on conflict (email) do nothing;
  return new;
end $$;
create trigger provision_app_user after insert on auth.users
  for each row execute function auth_user_provision();

-- RLS on every table, including the ones only the service role touches
-- (service_role bypasses RLS; anon is granted nothing). The helpers are wrapped
-- in a scalar subquery so Postgres evaluates them once per statement, not per
-- row; they still read app_users live, so role changes apply immediately.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy admin_all on public.%I for all to authenticated
       using ((select current_app_role()) = ''admin'')
       with check ((select current_app_role()) = ''admin'')', t);
  end loop;
end $$;

-- The member role's only reachable rows. No update policy: a logged chat is
-- corrected by deleting it inside the 24h window and logging it again.
create policy member_select_own on coffee_chats for select to authenticated
  using (member_id = (select current_person_id()));
create policy member_insert_own on coffee_chats for insert to authenticated
  with check (member_id = (select current_person_id()));
create policy member_delete_recent on coffee_chats for delete to authenticated
  using (member_id = (select current_person_id()) and created_at > now() - interval '24 hours');

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- people_directory is the security-definer view above: the only people data
-- a member may read, and the reason members need no policy on `people`.
grant select on people_directory to authenticated;
revoke execute on function member_log_coffee_chat(text, text, date, text) from public;
grant execute on function member_log_coffee_chat(text, text, date, text) to authenticated;

/*
 * Custom Access Token Hook: stamps the app role onto the JWT at sign-in and at
 * every token refresh, so middleware can route a request without asking the
 * database who the caller is.
 *
 * This claim is for ROUTING ONLY. Authorization stays in RLS, where
 * current_app_role() reads app_users live on every statement. A claim can be up
 * to `jwt_expiry` stale, so a demoted admin may still be routed to an admin page
 * until their token refreshes — and will find every query returns nothing,
 * because RLS never trusts the claim. That is the spec's own position: "Do not
 * rely on UI hiding; RLS is the enforcement" (§4.7).
 */
-- `set search_path` is required: the hook runs as supabase_auth_admin, whose
-- default search_path excludes public, so app_role_t would not resolve.
create function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable
set search_path = public, auth as $$
declare
  v_email text;
  v_role public.app_role_t;
  v_person uuid;
  v_claims jsonb;
begin
  select u.email into v_email from auth.users u where u.id = (event ->> 'user_id')::uuid;
  select a.role, a.person_id into v_role, v_person from app_users a where a.email = v_email::citext;

  v_claims := event -> 'claims';
  v_claims := jsonb_set(v_claims, '{app_role}', to_jsonb(coalesce(v_role::text, 'member')));
  v_claims := jsonb_set(v_claims, '{person_id}',
                        case when v_person is null then 'null'::jsonb else to_jsonb(v_person::text) end);

  return jsonb_set(event, '{claims}', v_claims);
end $$;

-- Only the auth server may run the hook, and it needs to read the allowlist.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on table public.app_users to supabase_auth_admin;

create policy app_users_auth_admin_read on app_users
  as permissive for select to supabase_auth_admin using (true);

/* ── Storage ────────────────────────────────────────────────────────── */

/*
 * Storage RLS for the raw CSV uploads.
 *
 * §4.7 grants admins full access to every table in `public`, but the import
 * wizard also writes the uploaded file to Storage, and storage.objects has RLS
 * on with no policy — so an authenticated admin got "new row violates row-level
 * security policy" the moment the app ran as a real user instead of the
 * service role.
 *
 * The bucket is created here as well as in config.toml: config.toml only builds
 * it locally and never touches a linked project.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imports', 'imports', false, 52428800,
        array['text/csv', 'application/vnd.ms-excel', 'text/plain'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Admins only: the files carry names, emails and resume links. Members never
-- touch Storage, and the bucket stays private, so downloads go through the app.
drop policy if exists imports_admin_read on storage.objects;
drop policy if exists imports_admin_insert on storage.objects;
drop policy if exists imports_admin_update on storage.objects;
drop policy if exists imports_admin_delete on storage.objects;

create policy imports_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'imports' and public.current_app_role() = 'admin');

create policy imports_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'imports' and public.current_app_role() = 'admin');

create policy imports_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'imports' and public.current_app_role() = 'admin')
  with check (bucket_id = 'imports' and public.current_app_role() = 'admin');

create policy imports_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'imports' and public.current_app_role() = 'admin');
