import { verifyHmacBase64 } from '@/lib/slack/verify';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Luma webhook (spec §6, §11.2). v1 stores the raw payload and returns 200;
 * mapping guests to registrations is §11.2 work, deliberately not built.
 * Writing to `webhook_inbox` before processing is what makes it replayable.
 */
export async function POST(req: Request) {
  const raw = await req.text(); // signed over the raw bytes; never re-serialise (§11.2)
  const secret = process.env.LUMA_WEBHOOK_SECRET;
  if (!secret) return new Response('LUMA_WEBHOOK_SECRET not configured', { status: 503 });
  if (!verifyHmacBase64(raw, req.headers.get('luma-signature'), secret)) {
    return new Response('bad signature', { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { payload = raw; }

  await createServiceClient().from('webhook_inbox').insert({
    provider: 'luma',
    headers: Object.fromEntries(req.headers),
    payload,
    processed: false,
  });
  return new Response('ok');
}
