'use client';
import { useState } from 'react';
import { GoogleLogo } from '@phosphor-icons/react/dist/ssr';
import { createClient } from '@/lib/supabase/client';

export function LoginButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-primary h-[42px] gap-[10px] text-[14px]"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        // `hd` is a hint only — Google does not enforce it. Enforcement is the
        // auth.users trigger plus middleware (spec §5).
        await createClient().auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
            queryParams: { hd: 'umich.edu', prompt: 'select_account' },
          },
        });
      }}
    >
      <GoogleLogo size={16} aria-hidden />
      {label}
    </button>
  );
}
