import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client: bypasses RLS by design.
 * ONLY for /api/webhooks/*, /api/slack/*, and scheduled functions, each of which
 * MUST verify its own signature (spec §5). Never import this into a page or a
 * Server Action.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
