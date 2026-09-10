import { revalidate, tags } from '@/lib/cache';
import { handleSlackEvent, type SlackEnvelope } from '@/lib/slack/handlers';
import { verifySlackSignature } from '@/lib/slack/verify';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Slack Events API endpoint (spec §8.1–8.3).
 *
 * Budget: a 2xx inside three seconds. Verify, dedupe, one handler, return. No
 * fan-out — the only Slack call any handler may make is the single `users.info`
 * in §8.3, on a client with retries disabled so it cannot eat the budget.
 * Nothing here logs the payload: message text must not reach a log line.
 */
export async function POST(req: Request) {
  // Raw body first: the signature covers these exact bytes, and JSON.parse ->
  // JSON.stringify reorders keys and whitespace, which breaks the digest.
  const raw = await req.text();
  const ok = verifySlackSignature(
    raw,
    req.headers.get('x-slack-signature'),
    req.headers.get('x-slack-request-timestamp'),
  );
  if (!ok) return new Response('bad signature', { status: 401 });

  const envelope = JSON.parse(raw) as SlackEnvelope;
  if (envelope.type === 'url_verification') {
    return Response.json({ challenge: envelope.challenge });
  }

  const db = createServiceClient();

  // Not a Slack type: the daily Netlify function signs a request with the same
  // secret to ask for tag revalidation, which only works inside the Next runtime.
  if (envelope.type === 'v1_revalidate') {
    revalidate(tags.slack, tags.people);
    return new Response('ok');
  }

  // Retries (`X-Slack-Retry-Num`) replay the same envelope `event_id`. The unique
  // insert is the dedupe: 23505 means this event was already handled.
  if (envelope.event_id) {
    const { error } = await db.from('slack_event_dedupe').insert({ event_id: envelope.event_id });
    if (error?.code === '23505') return new Response('ok');
  }

  try {
    await handleSlackEvent(db, envelope);
  } catch (err) {
    // Event type and message only — never the payload (§8.3).
    console.error('slack handler failed', envelope.event?.type, (err as Error).message);
  }
  // 200 even on failure: a retry would be deduped anyway, and the daily sync
  // re-derives channels and user links, so a retry storm buys nothing.
  return new Response('ok');
}
