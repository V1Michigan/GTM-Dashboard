import { verifyHmacBase64 } from '@/lib/slack/verify';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Tally webhook (spec §6, §11.1). v1 stores the raw payload and returns 200;
 * routing a `formId` to an import kind is §11.1 work, deliberately not built.
 * Writing to `webhook_inbox` before processing is what makes it replayable.
 */
export async function POST(req: Request) {
  const raw = await req.text(); // signed over the raw bytes; never re-serialise (§11.1)
  const secret = process.env.TALLY_SIGNING_SECRET;
  if (!secret) return new Response('TALLY_SIGNING_SECRET not configured', { status: 503 });
  if (!verifyHmacBase64(raw, req.headers.get('tally-signature'), secret)) {
    return new Response('bad signature', { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { payload = raw; }

  await createServiceClient().from('webhook_inbox').insert({
    provider: 'tally',
    headers: Object.fromEntries(req.headers),
    payload,
    processed: false,
  });
  return new Response('ok');
}
