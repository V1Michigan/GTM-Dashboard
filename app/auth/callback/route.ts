import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Landing point for emailed auth links (password recovery, and email
 * confirmation if it is ever turned on). Sign-in and sign-up themselves are
 * handled inline by the login form and never come through here. An exchange
 * failure is sent to /login so the notice can explain it.
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
