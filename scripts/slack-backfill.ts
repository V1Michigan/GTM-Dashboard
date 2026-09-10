/**
 * One-time Slack history backfill (spec §8.5). Run locally with the bot token:
 *
 *   pnpm slack:backfill -- --since=2026-01-01
 *
 * Aggregates (user, channel, day) -> count from `conversations.history` and writes
 * `slack_channel_activity`. Message text is read from nothing but `m.user`/`m.ts`
 * and is never stored or logged.
 *
 * Two limits worth knowing: `conversations.history` is Tier 3 (~50 req/min), which
 * the pacing below plus the WebClient's own 429/`Retry-After` retry handles; and on
 * a free Slack workspace history is capped at 90 days, so anything older is simply
 * not there to fetch.
 */
import { pages, slack } from '../lib/slack/client';
import { slackDay } from '../lib/slack/handlers';
import { createServiceClient } from '../lib/supabase/service';

try { process.loadEnvFile('.env'); } catch { /* env may come from the shell */ }

const HISTORY_PACE_MS = 1_200; // ~50 requests/minute, the Tier 3 ceiling
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--since='))?.slice(8);
  const since = arg ?? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const oldest = (Date.parse(`${since}T00:00:00Z`) / 1000).toString();
  if (Number.isNaN(Number(oldest))) throw new Error(`bad --since=${arg}, expected YYYY-MM-DD`);

  const db = createServiceClient();
  const api = slack();

  const { data: people } = await db.from('people').select('id, slack_user_id')
    .not('slack_user_id', 'is', null).range(0, 9999);
  const personOf = new Map((people ?? []).map((p) => [p.slack_user_id as string, p.id as string]));

  const { data: channels } = await db.from('slack_channels').select('id, name')
    .eq('is_archived', false).eq('bot_is_member', true);

  const counts = new Map<string, number>(); // `${person_id}|${channel_id}|${day}` -> n
  let skipped = 0;

  for (const ch of channels ?? []) {
    let messages = 0;
    for await (const res of pages((cursor) =>
      api.conversations.history({ channel: ch.id, oldest, limit: 200, cursor }))) {
      for (const m of res.messages ?? []) {
        if (m.subtype && m.subtype !== 'thread_broadcast') continue;
        if (m.bot_id || !m.user || !m.ts) continue;
        const personId = personOf.get(m.user);
        if (!personId) { skipped += 1; continue; }
        const key = `${personId}|${ch.id}|${slackDay(m.ts)}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        messages += 1;
      }
      await sleep(HISTORY_PACE_MS);
    }
    console.log(`${ch.name}: ${messages} messages since ${since}`);
  }

  const rows = [...counts].map(([key, message_count]) => {
    const [person_id, channel_id, activity_date] = key.split('|');
    return { person_id, channel_id, activity_date, message_count };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('slack_channel_activity').upsert(rows.slice(i, i + 500));
    if (error) throw error;
  }

  console.log(`wrote ${rows.length} (person, channel, day) rows`);
  if (skipped) {
    console.log(
      `skipped ${skipped} messages from Slack users with no linked person — clear the review queue and re-run`,
    );
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
