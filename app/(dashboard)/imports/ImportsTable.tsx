'use client';
import { useMemo, useState } from 'react';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { Seg } from '@/components/ui/Seg';
import { Empty, Tag } from '@/components/ui/primitives';
import type { EventRow, ImportKind, ImportRecord, ImportStatus } from '@/lib/types';

export type ImportListRow = ImportRecord & { event: EventRow | null };

export const KIND_LABEL: Record<ImportKind, string> = {
  event_registration: 'Event registration',
  event_checkin: 'Event check-in',
  interest_form: 'Interest form',
  community_interest_form: 'Community interest form',
  product_studio_application: 'PS application',
  coffee_chat: 'Coffee chat',
  members_list: 'Members list',
  people_bulk: 'People bulk',
};

/** Everything renders in the club's timezone so the server and client agree (spec §4.9). */
const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  hour12: false, timeZone: 'America/Detroit',
});
export const fmtDateTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');

const STATUS: Record<ImportStatus, { label: string; tone: 'accent' | 'neutral' | 'outline' }> = {
  uploaded: { label: 'Draft', tone: 'neutral' },
  parsed: { label: 'Dry run', tone: 'neutral' },
  needs_review: { label: 'Needs review', tone: 'outline' },
  committed: { label: 'Committed', tone: 'accent' },
  failed: { label: 'Failed', tone: 'neutral' },
};

export function StatusTag({ status }: { status: ImportStatus }) {
  const s = STATUS[status];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

const num = (v: number | null, accent = false) =>
  v === null ? <span className="text-neutral-600">—</span>
    : <span className={accent && v > 0 ? 'text-accent-300' : undefined}>{v}</span>;

export function ImportsTable({ rows }: { rows: ImportListRow[] }) {
  const [filter, setFilter] = useState<'all' | 'needs_review' | 'failed'>('all');
  const [kind, setKind] = useState('');
  const [eventId, setEventId] = useState('');

  const events = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => r.event && map.set(r.event.id, r.event.name));
    return [...map];
  }, [rows]);

  const data = useMemo(() => rows.filter((r) =>
    (filter === 'all' || r.status === filter)
    && (kind === '' || r.kind === kind)
    && (eventId === '' || r.event_id === eventId)), [rows, filter, kind, eventId]);

  const columns: ColumnDef<ImportListRow, unknown>[] = [
    {
      accessorKey: 'created_at', header: 'Date',
      cell: ({ row }) => <span className="text-neutral-400">{fmtDateTime(row.original.created_at)}</span>,
    },
    { accessorFn: (r) => KIND_LABEL[r.kind], id: 'kind', header: 'Kind' },
    {
      id: 'context', header: 'Event / context',
      accessorFn: (r) => r.event?.name
        ?? (r.semester ? `${r.semester === 'fall' ? 'Fall' : 'Winter'} ${r.year ?? ''}`.trim() : ''),
      cell: ({ getValue }) => <Empty value={getValue<string>()} />,
    },
    {
      accessorKey: 'file_name', header: 'File',
      cell: ({ row }) => (
        <span className="block max-w-[220px] truncate text-neutral-400" title={row.original.file_name ?? ''}>
          <Empty value={row.original.file_name} />
        </span>
      ),
    },
    {
      accessorKey: 'status', header: 'Status',
      cell: ({ row }) => <StatusTag status={row.original.status} />,
    },
    { accessorKey: 'row_count', header: 'Rows', meta: { numeric: true }, cell: ({ row }) => num(row.original.row_count) },
    { accessorKey: 'rows_new', header: 'New', meta: { numeric: true }, cell: ({ row }) => num(row.original.rows_new) },
    { accessorKey: 'rows_updated', header: 'Updated', meta: { numeric: true }, cell: ({ row }) => num(row.original.rows_updated) },
    { accessorKey: 'rows_unchanged', header: 'Unchanged', meta: { numeric: true }, cell: ({ row }) => num(row.original.rows_unchanged) },
    { accessorKey: 'rows_review', header: 'Review', meta: { numeric: true }, cell: ({ row }) => num(row.original.rows_review, true) },
    { accessorKey: 'rows_failed', header: 'Failed', meta: { numeric: true }, cell: ({ row }) => num(row.original.rows_failed) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Seg
          name="import-status" value={filter} onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'needs_review', label: 'Needs review' },
            { value: 'failed', label: 'Failed' },
          ]}
        />
        <select className="input w-[170px]" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">Kind: any</option>
          {Object.entries(KIND_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select className="input w-[170px]" value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">
          <option value="">Event: any</option>
          {events.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      <DataTable
        data={data} columns={columns} rowHref={(r) => `/imports/${r.id}`}
        empty={<p className="text-[13px] text-neutral-500">No imports match this filter.</p>}
      />
    </div>
  );
}
