import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Google OAuth landing. The domain/allowlist trigger on auth.users (spec §4.7)
 * rejects disallowed accounts, which surfaces here as an exchange error; send
 * that to /login so the rejected-account notice can name the address.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }
  const description = searchParams.get('error_description') ?? 'Sign-in failed';
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(description)}`);
}
