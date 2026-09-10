import { pages, slack, TRACK_PRIVATE_CHANNELS } from '../../lib/slack/client';
import { matchSlackUser, type SlackUserObject } from '../../lib/slack/handlers';
import { signSlack } from '../../lib/slack/verify';
import { createServiceClient } from '../../lib/supabase/service';

/**
 * Daily Slack sync (spec §8.4). Scheduled in netlify.toml. The five steps in order:
 * channels, joins, users, prune, revalidate. Joining public channels is what makes
 * message events arrive at all, and the user pass self-heals missed `team_join`s.
 */
export default async () => {
  const db = createServiceClient();
  const api = slack();
  const types = TRACK_PRIVATE_CHANNELS ? 'public_channel,private_channel' : 'public_channel';
  const summary = { channels: 0, joined: 0, users: 0, matched: 0, pruned: 0 };

  // 1. Upsert every channel. `bot_is_member` is deliberately absent from the
  //    payload so this never clobbers what step 2 and the events route set.
  const seen: { id: string; name: string; is_private: boolean; is_archived: boolean }[] = [];
  for await (const res of pages((cursor) =>
    api.conversations.list({ types, limit: 200, exclude_archived: false, cursor }))) {
    for (const c of res.channels ?? []) {
      if (!c.id) continue;
      seen.push({
        id: c.id, name: c.name ?? c.id,
        is_private: !!c.is_private, is_archived: !!c.is_archived,
      });
    }
  }
  if (seen.length) {
    await db.from('slack_channels')
      .upsert(seen.map((c) => ({ ...c, last_synced_at: new Date().toISOString() })));
    summary.channels = seen.length;
  }

  // 2. Join every public, unarchived channel the bot is not in yet. Private channels
  //    are never joined programmatically — the bot must be invited (§11.3).
  const { data: toJoin } = await db.from('slack_channels').select('id')
    .eq('bot_is_member', false).eq('is_archived', false).eq('is_private', false);
  for (const c of toJoin ?? []) {
    try {
      await api.conversations.join({ channel: c.id });
      await db.from('slack_channels').update({ bot_is_member: true }).eq('id', c.id);
      summary.joined += 1;
    } catch (err) {
      console.warn('conversations.join failed', c.id, (err as Error).message);
    }
  }

  // 3. Match every non-bot, non-deleted user with an email. Backfills everyone who
  //    joined before the bot existed; a person is still never created from Slack.
  const { data: linked } = await db.from('people').select('slack_user_id')
    .not('slack_user_id', 'is', null).range(0, 9999);
  const known = new Set((linked ?? []).map((p) => p.slack_user_id as string));

  const todo: SlackUserObject[] = [];
  for await (const res of pages((cursor) => api.users.list({ limit: 200, cursor }))) {
    for (const u of res.members ?? []) {
      if (!u.id || u.is_bot || u.deleted || !u.profile?.email || known.has(u.id)) continue;
      todo.push(u as SlackUserObject);
    }
  }
  summary.users = todo.length;
  // ponytail: a few round trips per user, five at a time. If the workspace ever
  // outgrows the function timeout, push the whole list into one SQL function.
  for (let i = 0; i < todo.length; i += 5) {
    const done = await Promise.all(todo.slice(i, i + 5).map((u) => matchSlackUser(db, u)));
    summary.matched += done.filter(Boolean).length;
  }

  // 4. Prune the retry-dedupe table; Slack stops retrying long before 7 days.
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count } = await db.from('slack_event_dedupe').delete({ count: 'exact' })
    .lt('received_at', cutoff);
  summary.pruned = count ?? 0;

  // 5. Revalidate `slack` and `people`. revalidateTag() only works inside the Next
  //    runtime and this is a standalone Netlify function, so ask the events route
  //    to do it — signed with the same secret and scheme Slack itself uses.
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (site && secret) {
    const body = JSON.stringify({ type: 'v1_revalidate' });
    const ts = Math.floor(Date.now() / 1000).toString();
    await fetch(`${site}/api/slack/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slack-request-timestamp': ts,
        'x-slack-signature': signSlack(body, ts, secret),
      },
      body,
    }).catch((err) => console.warn('revalidate ping failed', (err as Error).message));
  }

  console.log('slack-sync', summary);
  return new Response(JSON.stringify(summary), {
    headers: { 'content-type': 'application/json' },
  });
};
