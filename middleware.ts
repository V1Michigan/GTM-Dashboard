import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { AUTH_BYPASS } from '@/lib/flags';

const PUBLIC = ['/login', '/auth/callback', '/api/webhooks', '/api/slack'];
/** The only path a `member` may open. RLS is the enforcement; this is the routing. */
const MEMBER_PATH = '/coffee-chats/log';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const response = NextResponse.next({ request });
  if (AUTH_BYPASS) return response;

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
   * `app_role` is stamped on by the custom access token hook (baseline migration),
   * which removes the second round trip this used to make to `app_users`.
   * The claim only decides ROUTING. Every query the page then runs is still
   * checked by RLS against the live allowlist, so a role that changed since the
   * token was issued cannot be used to read anything.
   */
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return NextResponse.redirect(new URL('/login', request.url));

  // Fallback for a project where the hook is not enabled yet (config.toml only
  // configures the local stack; hosted Supabase enables it under Auth > Hooks).
  // Without this an absent claim would read as "not admin" and lock every admin
  // out of their own dashboard. Costs one query only while the hook is missing.
  let role = data.claims.app_role as string | undefined;
  if (role === undefined) {
    const { data: row } = await supabase
      .from('app_users').select('role').eq('email', data.claims.email!).maybeSingle();
    role = row?.role ?? 'member';
  }

  if (role !== 'admin') {
    if (pathname === MEMBER_PATH) return response;
    // Members get 404, not a redirect: the other routes do not exist for them.
    return pathname === '/'
      ? NextResponse.redirect(new URL(MEMBER_PATH, request.url))
      : new NextResponse(null, { status: 404 });
  }
  return response;
}

/**
 * What the edge function is allowed to skip entirely.
 *
 * PUBLIC is repeated here on purpose: matching it in the matcher means the edge
 * function never boots for a Slack or Tally webhook, which is the bulk of the
 * traffic this site gets. The runtime check above stays as the real guard — if
 * this regex is ever edited wrong, the worst case must be a wasted invocation,
 * not an unauthenticated page.
 *
 * RSC payload requests are deliberately NOT excluded. The router fires one per
 * sidebar link on hover, so they are most of the invocations — but they return
 * page content, and skipping the check here would let a `member` prefetch an
 * admin page's payload. RLS would still refuse the data; the 404 is the layer
 * that says the route does not exist for them, and it stays.
 */
/*
 * One string literal, however long. Next parses this export statically at build
 * time and rejects anything it cannot read as a constant — splitting it with
 * `+` fails the build with `Unsupported node type "BinaryExpression"`.
 */
export const config = {
  // eslint-disable-next-line max-len
  matcher: ['/((?!_next/static|_next/image|(?:login|auth/callback|api/webhooks|api/slack)(?:/|$)|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|ico|jpe?g|gif|webp|avif|woff2?|ttf|otf|map)$).*)'],
};
