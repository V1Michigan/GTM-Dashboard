'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Sign-in only. Accounts are provisioned by an admin in /settings — there is no
 * self-serve sign-up, and `enable_signup = false` closes the public endpoint so
 * removing the button is not the only thing stopping it.
 */
export function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const { error: err } = await createClient().auth.signInWithPassword({ email, password });
        setPending(false);
        if (err) { setError(err.message); return; }
        router.push('/');
        router.refresh();
      }}
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
          id="password" type="password" className="input" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button type="submit" className="btn btn-primary h-[42px] text-[14px]" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
