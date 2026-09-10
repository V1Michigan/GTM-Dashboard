'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Email + password. Access is not decided here: the allowlist trigger on
 * auth.users (migration 0012) refuses anything that is not an @umich.edu
 * address belonging to an admin or a current V1 member. GoTrue reports a
 * trigger failure as an opaque database error, so a failed sign-up is shown
 * with the reason it is actually refused for.
 */
const REJECTED =
  "isn't a umich.edu address on the admin list or a current V1 member. " +
  'Try a different address, or ask an admin to add you.';

export function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'in' | 'up' | null>(null);

  async function submit(mode: 'in' | 'up') {
    setPending(mode);
    setError(null);
    const supabase = createClient();
    const { error: err } =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setPending(null);

    if (!err) {
      router.push('/');
      router.refresh();
      return;
    }
    // A rejected sign-up surfaces as "Database error saving new user".
    setError(
      mode === 'up' && /database error/i.test(err.message)
        ? `${email || 'That address'} ${REJECTED}`
        : err.message,
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => { e.preventDefault(); void submit('in'); }}
    >
      {error && (
        <div className="notice flex flex-col gap-1">
          <div className="text-[13px] font-medium">That account can&rsquo;t sign in</div>
          <div className="text-[12.5px] text-neutral-400">{error}</div>
        </div>
      )}

      <div className="field">
        <label htmlFor="email">umich.edu email</label>
        <input
          id="email" type="email" className="input" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password" type="password" className="input" autoComplete="current-password"
          required minLength={8}
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary h-[42px] flex-1 text-[14px]" disabled={pending !== null}>
          {pending === 'in' ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          type="button" className="btn btn-secondary h-[42px] text-[14px]"
          disabled={pending !== null} onClick={() => void submit('up')}
        >
          {pending === 'up' ? 'Creating…' : 'Create account'}
        </button>
      </div>
    </form>
  );
}
