import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail, uniqnameFromEmail } from '@/lib/matching/normalize';
import type { MatchCandidate } from '@/lib/types';
import { slack } from './client';

/**
 * Slack event handlers (spec §8.3).
 *
 * Message *text* is never read, logged or stored — not at debug level, not in an
 * error line. Nothing in this file touches `event.text`, and no handler passes an
 * event payload to a logger. That is a product promise, so treat it as a boundary.
 */

export interface SlackUserObject {
  id: string;
  deleted?: boolean;
  is_bot?: boolean;
  real_name?: string;
  profile?: { email?: string; real_name?: string; display_name?: string };
}

interface SlackEvent {
  type: string;
  subtype?: string;
  bot_id?: string;
  user?: string | SlackUserObject;
  channel?: string | { id: string; name?: string };
  ts?: string;
  event_ts?: string;
}

export interface SlackEnvelope {
  type: string;
  event_id?: string;
  challenge?: string;
  event?: SlackEvent;
  authorizations?: { user_id?: string; is_bot?: boolean }[];
}

interface MatchResult {
  person_id: string | null;
  confidence: number | string | null;
  candidates: MatchCandidate[] | null;
}

const AUTO_LINK = 0.9;

/** Slack `ts` is epoch seconds; the club is in Michigan, so days are Detroit days. */
const DETROIT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit' });
export const slackDay = (ts?: string): string =>
  DETROIT_DAY.format(ts ? new Date(Number(ts.split('.')[0]) * 1000) : new Date());

const emailOf = (u: SlackUserObject) => u.profile?.email ?? null;
const nameOf = (u: SlackUserObject) => u.profile?.real_name ?? u.real_name ?? null;

/* ── Writes ───────────────────────────────────────────────────────────── */

/*
 * ponytail: read-then-upsert, so two messages in the same channel on the same day
 * arriving concurrently can lose a count. An `on conflict do update set
 * message_count = message_count + n` SQL function would be exact; at V1's volume
 * (tens of messages a day) one lost count is not worth a migration.
 */
async function addActivity(
  db: SupabaseClient, personId: string, channelId: string, day: string, n = 1,
) {
  const key = { person_id: personId, channel_id: channelId, activity_date: day };
  const { data } = await db.from('slack_channel_activity')
    .select('message_count').match(key).maybeSingle();
  await db.from('slack_channel_activity')
    .upsert({ ...key, message_count: (data?.message_count ?? 0) + n });
}

/**
 * Link a Slack account to a person: set the ids, keep the earliest join date, add
 * the email, flush anything buffered while they were unmatched, close their review
 * item. Exported so the review-queue resolver runs exactly this path (§8.3).
 */
export async function linkSlackUser(
  db: SupabaseClient,
  slackUserId: string,
  personId: string,
  opts: { email?: string | null; joinedAt?: string | null } = {},
): Promise<void> {
  await db.from('people').update({ slack_user_id: slackUserId }).eq('id', personId);
  await db.from('people')
    .update({ slack_joined_at: opts.joinedAt ?? new Date().toISOString() })
    .eq('id', personId).is('slack_joined_at', null);

  if (opts.email) {
    await db.from('person_emails').upsert(
      {
        person_id: personId, email: opts.email, email_normalized: normalizeEmail(opts.email),
        is_primary: false, source: 'slack',
      },
      { onConflict: 'email_normalized', ignoreDuplicates: true },
    );
  }

  const { data: buffered } = await db.from('slack_unmatched_users')
    .select('pending_message_counts').eq('slack_user_id', slackUserId).maybeSingle();
  const pending = (buffered?.pending_message_counts ?? {}) as Record<string, Record<string, number>>;
  for (const [channelId, days] of Object.entries(pending)) {
    for (const [day, count] of Object.entries(days)) {
      await addActivity(db, personId, channelId, day, count);
    }
  }
  await db.from('slack_unmatched_users').delete().eq('slack_user_id', slackUserId);
  await db.from('review_items')
    .update({
      status: 'resolved',
      resolution: { action: 'link', person_id: personId, by: 'slack' },
      resolved_at: new Date().toISOString(),
    })
    .eq('slack_user_id', slackUserId).eq('status', 'open');
}

/** Buffer an unknown Slack user and raise one review item the first time we see them. */
async function flagUnmatched(
  db: SupabaseClient, u: SlackUserObject, candidates: MatchCandidate[],
  counts?: Record<string, Record<string, number>>,
) {
  // Keyed on the review item, not the buffer row: the nightly sync re-runs this for
  // every unmatched user, and a dismissed item must not come back every morning.
  const { data: seen } = await db.from('review_items')
    .select('id').eq('slack_user_id', u.id).limit(1).maybeSingle();

  await db.from('slack_unmatched_users').upsert({
    slack_user_id: u.id,
    email: emailOf(u),
    real_name: nameOf(u),
    display_name: u.profile?.display_name ?? null,
    last_seen_at: new Date().toISOString(),
    ...(counts ? { pending_message_counts: counts } : {}),
  });

  if (seen) return;
  await db.from('review_items').insert({
    kind: candidates.length ? 'ambiguous_match' : 'no_match',
    slack_user_id: u.id,
    payload: {
      source: 'slack', slack_user_id: u.id, email: emailOf(u),
      real_name: nameOf(u), display_name: u.profile?.display_name ?? null,
    },
    candidates,
  });
}

/**
 * The match ladder for a Slack user (§8.3). Returns the person id when the match is
 * good enough to auto-link. A person is NEVER created from Slack alone: Slack has
 * alumni and guests in it, and a review click is cheap.
 */
export async function matchSlackUser(
  db: SupabaseClient, u: SlackUserObject, joinedAt?: string | null,
): Promise<string | null> {
  const email = emailOf(u);
  const { data } = await db.rpc('match_person', {
    p_email: email,
    p_name: nameOf(u),
    p_uniqname: email ? uniqnameFromEmail(email) : null,
    p_slack_user_id: u.id,
  });
  const m = (Array.isArray(data) ? data[0] : data) as MatchResult | undefined;

  if (m?.person_id && Number(m.confidence) >= AUTO_LINK) {
    await linkSlackUser(db, u.id, m.person_id, { email, joinedAt });
    return m.person_id;
  }
  await flagUnmatched(db, u, m?.candidates ?? []);
  return null;
}

/* ── Event handlers ───────────────────────────────────────────────────── */

async function onMessage(db: SupabaseClient, e: SlackEvent) {
  // §8.3: real human messages only. Edits, deletes, joins, bot posts and every
  // other subtype are dropped here, before anything is read off the payload.
  if (e.subtype && e.subtype !== 'thread_broadcast') return;
  if (e.bot_id || typeof e.user !== 'string' || typeof e.channel !== 'string') return;

  const day = slackDay(e.event_ts ?? e.ts);
  const { data: person } = await db.from('people')
    .select('id').eq('slack_user_id', e.user).maybeSingle();
  if (person) return addActivity(db, person.id, e.channel, day);

  const { data: unmatched } = await db.from('slack_unmatched_users')
    .select('pending_message_counts').eq('slack_user_id', e.user).maybeSingle();

  if (!unmatched) {
    // First sight of this Slack id: the single `users.info` §8.3 allows, then the
    // normal ladder. Later messages from the same id cost no API call.
    const u = await profile(e.user);
    const personId = u && await matchSlackUser(db, u);
    if (personId) return addActivity(db, personId, e.channel, day);
  }

  // Still unknown: buffer the count. The review resolver (or a later match) flushes it.
  const counts = (unmatched?.pending_message_counts ?? {}) as Record<string, Record<string, number>>;
  const channel = counts[e.channel] ?? {};
  counts[e.channel] = { ...channel, [day]: (channel[day] ?? 0) + 1 };
  await db.from('slack_unmatched_users').upsert({
    slack_user_id: e.user,
    pending_message_counts: counts,
    last_seen_at: new Date().toISOString(),
  });
}

async function profile(userId: string): Promise<SlackUserObject | null> {
  try {
    const res = await slack({ fast: true }).users.info({ user: userId });
    return (res.user as SlackUserObject | undefined) ?? null;
  } catch {
    return null; // the daily sync backfills every user anyway (§8.4 step 3)
  }
}

/** team_join and user_change both carry the whole user object, so no API call. */
async function onUser(db: SupabaseClient, u: SlackUserObject | undefined, joinedAt: string | null) {
  if (!u?.id || u.is_bot || u.deleted) return;
  const { data: linked } = await db.from('people')
    .select('id').eq('slack_user_id', u.id).maybeSingle();
  if (linked) return; // already linked; user_change only re-matches the unmatched
  await matchSlackUser(db, u, joinedAt);
}

export async function handleSlackEvent(db: SupabaseClient, envelope: SlackEnvelope): Promise<void> {
  const e = envelope.event;
  if (!e) return;
  const channelId = typeof e.channel === 'string' ? e.channel : e.channel?.id;

  switch (e.type) {
    case 'message':
      return onMessage(db, e);
    case 'team_join':
      return onUser(db, e.user as SlackUserObject | undefined, new Date().toISOString());
    case 'user_change':
      return onUser(db, e.user as SlackUserObject | undefined, null);
    case 'channel_created': {
      if (typeof e.channel === 'object' && e.channel?.id) {
        await db.from('slack_channels').upsert({
          id: e.channel.id, name: e.channel.name ?? e.channel.id, is_archived: false,
        });
      }
      return;
    }
    case 'channel_archive':
    case 'channel_unarchive': {
      if (channelId) {
        await db.from('slack_channels')
          .update({ is_archived: e.type === 'channel_archive' }).eq('id', channelId);
      }
      return;
    }
    case 'member_joined_channel': {
      // Only the bot's own join matters: it is what starts message events arriving.
      const bot = envelope.authorizations?.find((a) => a.is_bot)?.user_id;
      if (channelId && bot && e.user === bot) {
        await db.from('slack_channels').update({ bot_is_member: true }).eq('id', channelId);
      }
      return;
    }
  }
}
