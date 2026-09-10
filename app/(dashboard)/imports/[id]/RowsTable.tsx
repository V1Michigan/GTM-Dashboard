'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { Seg } from '@/components/ui/Seg';
import { Empty, Tag } from '@/components/ui/primitives';
import type { ImportRowRecord, Json, Person } from '@/lib/types';

export type ImportRowWithPerson = ImportRowRecord & { person: Person | null };

const isBadRow = (row: ImportRowWithPerson) => row.error?.startsWith('bad_row') ?? false;

/** Rows are only ever a mapped shape or the raw CSV shape; look in both, normalising headers. */
function pick(row: ImportRowWithPerson, keys: string[]): string | null {
  const sources: Record<string, Json>[] = [row.parsed ?? {}, row.raw ?? {}];
  for (const source of sources) {
    for (const [k, v] of Object.entries(source)) {
      if (keys.includes(k.toLowerCase().replace(/\s+/g, '_')) && v) return String(v);
    }
  }
  return null;
}

const nameOf = (row: ImportRowWithPerson) => {
  const first = pick(row, ['first_name']);
  const last = pick(row, ['last_name']);
  return [first, last].filter(Boolean).join(' ') || pick(row, ['name', 'full_name']);
};

function StatusCell({ row }: { row: ImportRowWithPerson }) {
  if (row.status === 'applied') return <Tag tone="accent">applied</Tag>;
  if (row.status === 'review') return <Tag tone="outline">review</Tag>;
  if (row.status === 'failed') return isBadRow(row) ? <Tag tone="neutral">skipped</Tag> : <Tag tone="outline">failed</Tag>;
  if (row.status === 'skipped_unchanged') return <Tag tone="neutral">skipped</Tag>;
  return <Tag tone="neutral">pending</Tag>;
}

const FILTERS = {
  all: () => true,
  applied: (r: ImportRowWithPerson) => r.status === 'applied',
  review: (r: ImportRowWithPerson) => r.status === 'review',
  skipped: (r: ImportRowWithPerson) => r.status === 'skipped_unchanged' || isBadRow(r),
  failed: (r: ImportRowWithPerson) => r.status === 'failed' && !isBadRow(r),
};

export function RowsTable({ rows }: { rows: ImportRowWithPerson[] }) {
  const [filter, setFilter] = useState<keyof typeof FILTERS>('all');
  const [search, setSearch] = useState('');
  const data = useMemo(() => rows.filter(FILTERS[filter]), [rows, filter]);

  const columns: ColumnDef<ImportRowWithPerson, unknown>[] = [
    { accessorKey: 'row_index', header: '#', cell: ({ row }) => <span className="text-neutral-500">{row.original.row_index}</span> },
    { id: 'name', header: 'Name', accessorFn: (r) => nameOf(r) ?? '', cell: ({ getValue }) => <Empty value={getValue<string>()} /> },
    {
      id: 'email', header: 'Email', accessorFn: (r) => pick(r, ['email']) ?? '',
      cell: ({ getValue }) => <span className="text-neutral-400"><Empty value={getValue<string>()} /></span>,
    },
    {
      id: 'person', header: 'Matched person',
      accessorFn: (r) => [r.person?.first_name, r.person?.last_name].filter(Boolean).join(' '),
      cell: ({ row, getValue }) => (row.original.person
        ? <Link href={`/people/${row.original.person.id}`} className="no-underline">{getValue<string>()}</Link>
        : <span className="text-neutral-600">—</span>),
    },
    {
      accessorKey: 'match_confidence', header: 'Confidence', meta: { numeric: true },
      cell: ({ row }) => (row.original.match_confidence === null
        ? <span className="text-neutral-600">—</span>
        : Number(row.original.match_confidence).toFixed(2)),
    },
    { id: 'status', header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusCell row={row.original} /> },
    {
      accessorKey: 'error', header: 'Error / note',
      cell: ({ row }) => <span className="text-neutral-500"><Empty value={row.original.error} /></span>,
    },
  ];

  const count = (k: keyof typeof FILTERS) => rows.filter(FILTERS[k]).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Seg
          name="rows" value={filter} onChange={setFilter}
          options={[
            { value: 'all', label: 'All rows', count: rows.length },
            { value: 'applied', label: 'Applied', count: count('applied') },
            { value: 'review', label: 'Review', count: count('review') },
            { value: 'skipped', label: 'Skipped', count: count('skipped') },
            { value: 'failed', label: 'Failed', count: count('failed') },
          ]}
        />
        <input
          className="input w-[220px]" placeholder="Search rows" value={search}
          onChange={(e) => setSearch(e.target.value)} aria-label="Search rows"
        />
      </div>
      <DataTable
        data={data} columns={columns} globalFilter={search}
        empty={<p className="text-[13px] text-neutral-500">No rows match this filter.</p>}
      />
    </div>
  );
}
