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
