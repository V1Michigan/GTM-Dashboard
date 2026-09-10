import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC = ['/login', '/auth/callback', '/api/webhooks', '/api/slack'];
/** The only path a `member` may open. RLS is the enforcement; this is the routing. */
const MEMBER_PATH = '/coffee-chats/log';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const response = NextResponse.next({ request });
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_BYPASS_AUTH === 'true') return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)),
      },
    },
  );

  /*
   * getClaims() verifies the JWT signature locally with WebCrypto against the
   * project's cached JWKS, so a navigation costs no network call — unlike
   * getUser(), which asks the Auth server on every request. It still refreshes
   * the session cookie when the token is close to expiring.
   *
   * `app_role` is stamped on by the custom access token hook (migration 0013),
   * which removes the second round trip this used to make to `app_users`.
   * The claim only decides ROUTING. Every query the page then runs is still
   * checked by RLS against the live allowlist, so a role that changed since the
   * token was issued cannot be used to read anything.
   */
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return NextResponse.redirect(new URL('/login', request.url));

  if (data.claims.app_role !== 'admin') {
    if (pathname === MEMBER_PATH) return response;
    // Members get 404, not a redirect: the other routes do not exist for them.
    return pathname === '/'
      ? NextResponse.redirect(new URL(MEMBER_PATH, request.url))
      : new NextResponse(null, { status: 404 });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico)$).*)'],
};
