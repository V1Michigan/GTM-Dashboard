import Image from 'next/image';
import { AuthForm } from './AuthForm';

/**
 * The allowlist trigger on auth.users (spec §4.7) is what rejects an account.
 * `error` carries a message from a redirect (e.g. an expired email link); a
 * failed sign-in or sign-up is reported inline by the form itself.
 */
export default async function LoginPage(
  { searchParams }: { searchParams: Promise<{ error?: string }> },
) {
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="flex w-[360px] flex-col gap-[22px]">
        <div className="flex items-center gap-[10px]">
          <Image src="/v1-logo.png" alt="V1" width={30} height={30} priority className="size-[30px]" />
          <span className="text-[16px] font-medium">GTM Dashboard</span>
        </div>

        <div>
          <h1 className="mb-[6px] text-[26px]">Sign in</h1>
          <p className="m-0 text-[14px] text-neutral-400">
            Use your umich.edu email. Access is limited to V1 admins and current members.
          </p>
        </div>

        {error && (
          <div className="notice flex flex-col gap-1">
            <div className="text-[13px] font-medium">That account can&rsquo;t sign in</div>
            <div className="text-[12.5px] text-neutral-400">{error}</div>
          </div>
        )}

        <AuthForm />

        <p className="m-0 text-[12px] text-neutral-600">
          Accounts are created by a V1 admin. If you don&rsquo;t have one, ask an admin to add
          you. Members are routed to the coffee-chat logger; admins land on the overview.
        </p>
      </div>
    </main>
  );
}
