import Link from 'next/link';
import { Sidebar } from '@/components/Sidebar';
import { requireSession } from '@/lib/auth';
import { myCoffeeChats, openReviewCount, peopleDirectoryLive } from '@/lib/queries';
import { LogForm, type RecentChat } from '@/app/(dashboard)/coffee-chats/LogForm';
import type { PeopleDirectoryRow } from '@/lib/types';

/**
 * The only page the `member` role may open, so it lives outside `(dashboard)`
 * — whose layout calls requireAdmin() — and guards itself with requireSession().
 * The URL is unchanged; an admin still gets the normal sidebar shell.
 */
const option = (p: PeopleDirectoryRow) => ({
  id: p.id,
  name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.primary_email || 'Unknown',
  email: p.primary_email,
});

/** Live per-request data; never prerender. See app/(dashboard)/layout.tsx. */
export const dynamic = 'force-dynamic';

export default async function LogCoffeeChatPage() {
  const session = await requireSession();
  const isAdmin = session.role === 'admin';
  const directory = await peopleDirectoryLive();
  const people = directory.map(option);
  const me = session.personId;
  const chats = me ? await myCoffeeChats(me) : [];
  const today = new Date().toISOString().slice(0, 10);
  const myName = people.find((p) => p.id === me)?.name ?? null;

  const recent: RecentChat[] = chats.slice(0, 8).map((c) => {
    const hours = (Date.now() - new Date(c.created_at).getTime()) / 3_600_000;
    return {
      id: c.id,
      name: [c.person?.first_name, c.person?.last_name].filter(Boolean).join(' ') || 'Unknown',
      when: hours < 24
        ? `${Math.max(1, Math.round(hours))}h ago`
        : new Date(`${c.chatted_on ?? c.created_at.slice(0, 10)}T00:00`)
          .toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      deletable: hours < 24,
    };
  });

  const form = (
    <LogForm
      people={people}
      members={isAdmin ? directory.filter((d) => d.is_v1_member).map(option) : null}
      recent={recent}
      today={today}
      compact={!isAdmin}
    />
  );

  if (isAdmin) {
    return (
      <div className="flex min-h-screen">
        <Sidebar email={session.email} role={session.role} reviewCount={await openReviewCount()} />
        <main className="flex min-w-0 flex-1 flex-col gap-[22px] px-9 pb-10 pt-7">
          <div className="text-[12.5px] text-neutral-500">
            <Link href="/coffee-chats" className="text-neutral-400 no-underline">Coffee chats</Link> / Log
          </div>
          <div>
            <h1 className="mb-1 text-[24px]">Log a coffee chat</h1>
            <p className="m-0 text-[13px] text-neutral-400">
              Admin view: the member field is selectable. Members see the same form with it fixed.
            </p>
          </div>
          <div className="max-w-[520px]">{form}</div>
        </main>
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[430px] flex-col">
      <header className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
        <span className="flex items-center gap-2">
          <span className="grid size-[22px] place-items-center rounded-md border border-accent text-[10px] font-semibold text-accent">
            V1
          </span>
          <span className="text-[14px] font-medium">Coffee chats</span>
        </span>
        <form action="/auth/signout" method="post" className="text-[12px] text-neutral-500">
          {session.email.split('@')[0]} ·{' '}
          <button type="submit" className="min-h-[44px] text-accent">Sign out</button>
        </form>
      </header>
      <div className="flex flex-col gap-[18px] px-5 pb-6 pt-2">
        <div>
          <h1 className="mb-1 text-[22px]">Log a coffee chat</h1>
          {myName && <p className="m-0 text-[13px] text-neutral-400">Logged as {myName}.</p>}
        </div>
        {form}
      </div>
    </main>
  );
}
