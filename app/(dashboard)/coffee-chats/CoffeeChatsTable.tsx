'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { Empty } from '@/components/ui/primitives';
import { Seg } from '@/components/ui/Seg';
import { fmtDate } from '@/lib/format';

export interface ChatRow {
  id: string;
  /** chatted_on, or the day it was logged when that is null. Used for filtering. */
  on: string;
  memberId: string; memberName: string;
  personId: string; personName: string;
  notes: string | null;
  source: string;
  loggedBy: string;
}

type Range = '7d' | '30d' | 'semester' | 'all';

const local = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Derived from the `today` the server rendered with, so filtering is timezone-stable. */
function startOf(range: Range, today: string) {
  const now = new Date(`${today}T00:00`);
  if (range === 'all') return '';
  if (range === 'semester') return `${now.getFullYear()}-${now.getMonth() >= 7 ? '08' : '01'}-01`;
  now.setDate(now.getDate() - (range === '7d' ? 7 : 30));
  return local(now);
}

const shortDate = (d: string) =>
  fmtDate(d);

const columns: ColumnDef<ChatRow, unknown>[] = [
  {
    id: 'date', header: 'Date', accessorFn: (r) => r.on,
    cell: ({ row }) => <span className="text-neutral-400">{shortDate(row.original.on)}</span>,
  },
  { id: 'member', header: 'Member', accessorFn: (r) => r.memberName },
  {
    id: 'person', header: 'Person', accessorFn: (r) => r.personName,
    cell: ({ row }) => (
      <Link href={`/people/${row.original.personId}`} className="no-underline">{row.original.personName}</Link>
    ),
  },
  {
    id: 'notes', header: 'Notes', accessorFn: (r) => r.notes ?? '',
    cell: ({ row }) => (
      <span className="block max-w-[300px] truncate text-neutral-300">
        <Empty value={row.original.notes} />
      </span>
    ),
  },
  {
    id: 'source', header: 'Source', accessorFn: (r) => r.source,
    cell: ({ row }) => <span className="text-neutral-500">{row.original.source}</span>,
  },
  {
    id: 'logged', header: 'Logged by', accessorFn: (r) => r.loggedBy,
    cell: ({ row }) => <span className="text-neutral-500">{row.original.loggedBy}</span>,
  },
];

/** The whole body of `/coffee-chats`: filters + table, and the leaderboard rail. */
export function CoffeeChatsTable(
  { chats, memberCount, today }: { chats: ChatRow[]; memberCount: number; today: string },
) {
  const [member, setMember] = useState('');
  const [range, setRange] = useState<Range>('30d');
  const [search, setSearch] = useState('');
  const [board, setBoard] = useState<'30d' | 'semester'>('30d');

  const members = useMemo(() => {
    const byId = new Map(chats.map((c) => [c.memberId, c.memberName]));
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [chats]);

  const rows = useMemo(() => {
    const from = startOf(range, today);
    return chats.filter((c) => (!member || c.memberId === member) && c.on >= from);
  }, [chats, member, range, today]);

  const { leaders, active } = useMemo(() => {
    const from = startOf(board, today);
    const counts = new Map<string, number>();
    for (const c of chats) if (c.on >= from) counts.set(c.memberName, (counts.get(c.memberName) ?? 0) + 1);
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    return { leaders: ranked.slice(0, 8), active: ranked.length };
  }, [chats, board, today]);

  const idle = Math.max(0, memberCount - active);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-[200px]" aria-label="Filter by member"
            value={member} onChange={(e) => setMember(e.target.value)}
          >
            <option value="">Member: any</option>
            {members.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <Seg
            name="Date range" value={range} onChange={setRange}
            options={[
              { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' },
              { value: 'semester', label: 'Semester' }, { value: 'all', label: 'All' },
            ]}
          />
          <input
            className="input w-[220px]" placeholder="Search person or notes" aria-label="Search"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <DataTable
          data={rows} columns={columns} globalFilter={search}
          empty={<p className="text-[13px] text-neutral-500">No chats in this range.</p>}
        />
      </div>

      <aside className="card elev-sm gap-3 px-[18px] py-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[14px]">Leaderboard</h2>
          <Seg
            name="Leaderboard range" value={board} onChange={setBoard}
            options={[{ value: '30d', label: '30d' }, { value: 'semester', label: 'Semester' }]}
          />
        </div>
        <table className="table table-dense">
          <tbody>
            {leaders.map(([name, count], i) => (
              <tr key={name}>
                <td className="w-6 text-neutral-500">{i + 1}</td>
                <td>{name}</td>
                <td className="num">{count}</td>
              </tr>
            ))}
            {leaders.length === 0 && <tr><td className="text-neutral-500">Nobody yet.</td></tr>}
          </tbody>
        </table>
        <div className="text-[12px] text-neutral-500">
          {idle} member{idle === 1 ? ' has' : 's have'} not logged a chat
          {board === '30d' ? ' in 30 days' : ' this semester'}.
        </div>
      </aside>
    </div>
  );
}
