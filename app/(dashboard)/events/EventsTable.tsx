'use client';

import { useMemo, useState } from 'react';
import { CalendarBlank } from '@phosphor-icons/react/dist/ssr';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { Empty, Tag } from '@/components/ui/primitives';
import type { EventListRow } from '@/lib/queries';
import { fmtDayDateLong } from '@/lib/format';

const fmtDate = fmtDayDateLong;

/** 0 reads as "nothing imported yet" on an upcoming event, so it renders muted. */
const count = (n: number) => n ? <>{n}</> : <span className="text-neutral-600">—</span>;

const COLUMNS: ColumnDef<EventListRow, unknown>[] = [
  { id: 'name', header: 'Name', accessorKey: 'name' },
  {
    id: 'event_date', header: 'Date', accessorKey: 'event_date',
    cell: ({ row }) => <span className="text-neutral-400">{fmtDate(row.original.event_date)}</span>,
  },
  {
    id: 'event_type', header: 'Type', accessorKey: 'event_type',
    cell: ({ row }) => row.original.event_type
      ? <Tag tone="neutral">{row.original.event_type}</Tag>
      : <Empty value={null} />,
  },
  {
    id: 'registered_count', header: 'Registered', accessorKey: 'registered_count',
    meta: { numeric: true }, cell: ({ row }) => count(row.original.registered_count),
  },
  {
    id: 'checked_in_count', header: 'Checked in', accessorKey: 'checked_in_count',
    meta: { numeric: true }, cell: ({ row }) => count(row.original.checked_in_count),
  },
  {
    id: 'walk_in_count', header: 'Walk-ins', accessorKey: 'walk_in_count',
    meta: { numeric: true }, cell: ({ row }) => count(row.original.walk_in_count),
  },
  {
    id: 'member_checkin_count', header: 'Member check-ins', accessorKey: 'member_checkin_count',
    meta: { numeric: true }, cell: ({ row }) => count(row.original.member_checkin_count),
  },
  {
    id: 'open_review_items', header: 'Imports', accessorKey: 'open_review_items',
    cell: ({ row }) => row.original.open_review_items > 0
      ? <Tag tone="outline">{row.original.open_review_items} to review</Tag>
      : <span className="text-neutral-500">Clean</span>,
  },
];

export function EventsTable({ rows }: { rows: EventListRow[] }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');

  const types = useMemo(
    () => [...new Set(rows.map((r) => r.event_type).filter((t): t is string => !!t))].sort(),
    [rows],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      (type === '' || r.event_type === type)
      && (q === '' || `${r.name} ${r.location ?? ''}`.toLowerCase().includes(q)));
  }, [rows, search, type]);

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-center gap-2">
        <input
          className="input" style={{ width: 300 }} type="search" value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events" aria-label="Search events"
        />
        <select
          className="input" style={{ width: 140 }} value={type} onChange={(e) => setType(e.target.value)}
          aria-label="Event type"
        >
          <option value="">Type: any</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <DataTable
        data={shown}
        columns={COLUMNS}
        rowHref={(r) => `/events/${r.id}`}
        empty={
          <div className="notice flex items-center gap-3 text-neutral-500">
            <CalendarBlank size={20} />
            {rows.length === 0 ? 'No events yet. Create one to start importing attendance.' : 'No events match these filters.'}
          </div>
        }
      />
    </div>
  );
}
