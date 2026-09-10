import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { AUTH_BYPASS } from '@/lib/flags';
import type { AppRole } from '@/lib/types';

export interface Session {
  email: string;
  role: AppRole;
  personId: string | null;
  userId: string | null;
}

/**
 * The signed-in admin/member, or null.
 *
 * Reads the role from the JWT (stamped by the custom access token hook,
 * migration 0013) after verifying the signature locally against the cached
 * JWKS — no call to the Auth server and no `app_users` query per render.
 * RLS still checks the live allowlist on every statement, so this is routing
 * and UI only, never the authorization decision.
 */
export async function getSession(): Promise<Session | null> {
  if (AUTH_BYPASS) {
    return {
      email: process.env.SEED_ADMIN_EMAIL ?? 'dev@umich.edu',
      role: 'admin', personId: null, userId: null,
    };
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.email) return null;

  // Same fallback as middleware: if the access token hook is not enabled on this
  // project, the claim is absent and we fall back to the table rather than
  // silently demoting an admin. See middleware.ts.
  if (claims.app_role === undefined) {
    const { data: row } = await supabase
      .from('app_users').select('role, person_id').eq('email', claims.email).maybeSingle();
    return {
      email: claims.email,
      role: (row?.role as AppRole | undefined) ?? 'member',
      personId: (row?.person_id as string | null | undefined) ?? null,
      userId: (claims.sub as string | undefined) ?? null,
    };
  }

  return {
    email: claims.email,
    role: claims.app_role === 'admin' ? 'admin' : 'member',
    personId: (claims.person_id as string | null) ?? null,
    userId: (claims.sub as string | undefined) ?? null,
  };
}

/** Guard for every admin page. Members are sent to the one page they may see. */
export async function requireAdmin(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/coffee-chats/log');
  return session;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}
