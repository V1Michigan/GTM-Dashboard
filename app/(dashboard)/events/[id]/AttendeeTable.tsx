'use client';

import { useMemo, useState } from 'react';
import { UsersThree } from '@phosphor-icons/react/dist/ssr';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { Seg } from '@/components/ui/Seg';
import { Empty, Tag } from '@/components/ui/primitives';
import type { EventAttendee } from '@/lib/queries';
import { fmtTime } from '@/lib/format';

type Filter = 'all' | 'registered' | 'checked-in' | 'walk-ins' | 'no-shows';

const MUTED = 'text-neutral-600';
const name = (a: EventAttendee) =>
  [a.person?.first_name, a.person?.last_name].filter(Boolean).join(' ') || '(no name)';

const COLUMNS: ColumnDef<EventAttendee, unknown>[] = [
  { id: 'name', header: 'Name', accessorFn: name },
  {
    id: 'email', header: 'Email', accessorFn: (a) => a.person?.primary_email ?? '',
    cell: ({ row }) => <span className="text-neutral-400"><Empty value={row.original.person?.primary_email} /></span>,
  },
  {
    id: 'registered', header: 'Registered', accessorKey: 'registered',
    cell: ({ row }) => row.original.registered ? <>Yes</> : <span className={MUTED}>No</span>,
  },
  {
    id: 'status', header: 'Status',
    accessorFn: (a) => a.checked_in && !a.registered ? 'walk-in' : a.luma_approval_status ?? '',
    cell: ({ row }) => {
      const a = row.original;
      if (a.checked_in && !a.registered) return <Tag tone="outline">walk-in</Tag>;
      if (!a.luma_approval_status) return <Empty value={null} />;
      return a.luma_approval_status === 'approved'
        ? <>{a.luma_approval_status}</>
        : <span className="text-neutral-400">{a.luma_approval_status}</span>;
    },
  },
  {
    id: 'checked_in', header: 'Checked in', accessorKey: 'checked_in',
    cell: ({ row }) => row.original.checked_in ? <>Yes</> : <span className={MUTED}>No</span>,
  },
  {
    id: 'checked_in_at', header: 'Time', accessorKey: 'checked_in_at',
    cell: ({ row }) => <Empty value={fmtTime(row.original.checked_in_at)} />,
  },
  {
    id: 'source', header: 'Source',
    accessorFn: (a) => [a.registration_source, a.checkin_source].filter(Boolean).join(' · '),
    cell: ({ row }) => (
      <span className="text-neutral-500">
        <Empty value={[row.original.registration_source, row.original.checkin_source].filter(Boolean).join(' · ') || null} />
      </span>
    ),
  },
];

const MATCHES: Record<Filter, (a: EventAttendee) => boolean> = {
  'all': () => true,
  'registered': (a) => a.registered,
  'checked-in': (a) => a.checked_in,
  'walk-ins': (a) => a.checked_in && !a.registered,
  'no-shows': (a) => a.registered && !a.checked_in,
};

export function AttendeeTable({ rows }: { rows: EventAttendee[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = MATCHES[filter];
    return rows.filter((a) =>
      match(a) && (q === '' || `${name(a)} ${a.person?.primary_email ?? ''}`.toLowerCase().includes(q)));
  }, [rows, filter, search]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Seg
          name="attendees" value={filter} onChange={setFilter}
          options={(Object.keys(MATCHES) as Filter[]).map((value) => ({
            value,
            label: value === 'all' ? 'All'
              : value === 'checked-in' ? 'Checked in'
              : value === 'walk-ins' ? 'Walk-ins'
              : value === 'no-shows' ? 'No-shows' : 'Registered',
            count: rows.filter(MATCHES[value]).length,
          }))}
        />
        <input
          className="input" style={{ width: 220 }} type="search" value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search attendees" aria-label="Search attendees"
        />
      </div>

      <DataTable
        data={shown}
        columns={COLUMNS}
        rowHref={(a) => `/people/${a.person_id}`}
        empty={
          <div className="notice flex items-center gap-3 text-neutral-500">
            <UsersThree size={20} />
            {rows.length === 0
              ? 'No attendance yet. Upload a Luma registration or Tally check-in CSV.'
              : 'No attendees match this filter.'}
          </div>
        }
      />
    </div>
  );
}
