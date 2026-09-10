import Link from 'next/link';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { CoffeeChatsTable, type ChatRow } from './CoffeeChatsTable';
import { PageHeader } from '@/components/ui/primitives';
import { requireAdmin } from '@/lib/auth';
import { listCoffeeChats, peopleDirectory } from '@/lib/queries';

const name = (p: { first_name: string | null; last_name: string | null } | null) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'Unknown';

export default async function CoffeeChatsPage() {
  const [session, chats, directory] = await Promise.all([
    requireAdmin(), listCoffeeChats(), peopleDirectory(),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  const rows: ChatRow[] = chats.map((c) => ({
    id: c.id,
    on: c.chatted_on ?? c.created_at.slice(0, 10),
    memberId: c.member_id, memberName: name(c.member),
    personId: c.person_id, personName: name(c.person),
    notes: c.notes,
    source: c.source,
    // auth.users is not readable from here, so the logger resolves only to "you".
    loggedBy: c.logged_by ? (c.logged_by === session.userId ? 'you' : 'dashboard') : '—',
  }));

  const memberCount = directory.filter((p) => p.is_v1_member).length;
  const week = new Date(`${today}T00:00`);
  week.setDate(week.getDate() - 7);
  const weekStart =
    `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, '0')}-${String(week.getDate()).padStart(2, '0')}`;
  const last7 = rows.filter((r) => r.on >= weekStart).length;
  const logging = new Set(rows.map((r) => r.memberId)).size;

  return (
    <>
      <PageHeader
        title="Coffee chats"
        subtitle={`${rows.length} chats logged · ${logging} members logging · ${last7} in the last 7 days`}
        actions={
          <Link className="btn btn-primary" href="/coffee-chats/log">
            <Plus size={16} aria-hidden />Log a coffee chat
          </Link>
        }
      />
      <CoffeeChatsTable chats={rows} memberCount={memberCount} today={today} />
    </>
  );
}
