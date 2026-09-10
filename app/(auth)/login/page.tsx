import { LoginButton } from './LoginButton';

/**
 * The domain/allowlist trigger on auth.users (spec §4.7) is what actually
 * rejects an account; it surfaces here as an `error` query param carrying the
 * address that was turned away.
 */
export default async function LoginPage(
  { searchParams }: { searchParams: Promise<{ error?: string; email?: string }> },
) {
  const { error, email } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="flex w-[360px] flex-col gap-[22px]">
        <div className="flex items-center gap-[10px]">
          <div className="grid size-[30px] place-items-center rounded-lg border border-accent text-[13px] font-semibold text-accent">
            V1
          </div>
          <span className="text-[16px] font-medium">GTM Dashboard</span>
        </div>

        <div>
          <h1 className="mb-[6px] text-[26px]">Sign in</h1>
          <p className="m-0 text-[14px] text-neutral-400">
            Use your umich.edu Google account. Access is limited to V1 admins and current members.
          </p>
        </div>

        {error ? (
          <div className="notice flex flex-col gap-1">
            <div className="text-[13px] font-medium">That account can&rsquo;t sign in</div>
            <div className="text-[12.5px] text-neutral-400">
              {email ? `${email} isn't` : `That address isn't`} a umich.edu address on the admin
              list or a current V1 member. Try a different Google account, or ask an admin to add you.
            </div>
          </div>
        ) : null}

        <LoginButton label={error ? 'Try another account' : 'Continue with Google'} />

        {!error && (
          <p className="m-0 text-[12px] text-neutral-600">
            Members are routed to the coffee-chat logger. Admins land on the overview.
          </p>
        )}
      </div>
    </main>
  );
}
