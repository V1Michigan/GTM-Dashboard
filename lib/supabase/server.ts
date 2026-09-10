import { cookies } from 'next/headers';
import { createServerClient as createSSRClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

/**
 * DEV_BYPASS_AUTH (spec §9) injects a fixed admin session for faster local loops.
 * A bypassed session carries no user cookie, so RLS would deny every read and the
 * dashboard would render empty — the flag has to reach past RLS to be worth
 * anything. The branch is gated on NODE_ENV !== 'production', so it stays off
 * under a production runtime even when the flag is set.
 */
const DEV_BYPASS =
  process.env.NODE_ENV !== 'production' && process.env.DEV_BYPASS_AUTH === 'true';

/** Anon key + the signed-in user's cookies. RLS applies. Use for every page and Server Action. */
export async function createServerClient() {
  if (DEV_BYPASS) {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
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
