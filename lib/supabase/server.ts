import { cookies } from 'next/headers';
import { createServerClient as createSSRClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { AUTH_BYPASS } from '@/lib/flags';

/**
 * A bypassed session carries no user cookie, so RLS would deny every read and
 * the dashboard would render empty — the bypass has to reach past RLS to be
 * worth anything, which is why this returns the service-role client. See
 * lib/flags.ts for what that means in production.
 */

/** Anon key + the signed-in user's cookies. RLS applies. Use for every page and Server Action. */
export async function createServerClient() {
  if (AUTH_BYPASS) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) {
      throw new Error(
        'DEV_BYPASS_AUTH=true needs SUPABASE_SERVICE_ROLE_KEY: the bypass reads past RLS.',
      );
    }
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  const cookieStore = await cookies();
  return createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          // Server Components cannot set cookies; middleware refreshes the session.
          try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
          catch { /* called from a Server Component */ }
        },
      },
    },
  );
}
