'use client';

import { useEffect, useMemo, useState } from 'react';
import { Columns, UsersThree } from '@phosphor-icons/react/dist/ssr';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { Popover } from '@/components/ui/Popover';
import { Seg } from '@/components/ui/Seg';
import { Empty, Tag } from '@/components/ui/primitives';
import { gradeLabel } from '@/lib/grade';
import type { PersonListRow } from '@/lib/queries';

const STORAGE_KEY = 'v1gtm.people.columns';
const MUTED = 'text-neutral-600';

type Filter = 'all' | 'members' | 'slack' | 'no-slack';

const fullName = (r: PersonListRow) => [r.first_name, r.last_name].filter(Boolean).join(' ');
const dash = <span className={MUTED}>—</span>;

const COLUMNS: ColumnDef<PersonListRow, unknown>[] = [
  {
    id: 'name', header: 'Name', accessorFn: fullName, meta: { label: 'Name' },
    cell: ({ row }) => <Empty value={fullName(row.original) || null} />,
  },
  {
    id: 'primary_email', header: 'Primary email', accessorKey: 'primary_email',
    meta: { label: 'Primary email' },
    cell: ({ row }) => row.original.primary_email
      ? (
        <span className="text-neutral-400">
          {row.original.primary_email}
          {row.original.email_count > 1 && (
            <span className={`ml-1 text-[11px] ${MUTED}`}>+{row.original.email_count - 1}</span>
          )}
        </span>
      )
      : dash,
  },
  {
    id: 'grad_year', header: 'Grad year', accessorKey: 'grad_year',
    meta: { label: 'Grad year · grade' },
    cell: ({ row }) => {
      const { grad_year, student_level } = row.original;
      if (!grad_year) {
        return student_level === 'graduate' ? <span className="text-neutral-500">Graduate</span> : dash;
      }
      const grade = gradeLabel(grad_year);
      return <>{grad_year}{grade && <span className="text-neutral-500"> · {grade}</span>}</>;
    },
  },
  {
    id: 'major', header: 'Major', accessorKey: 'major', meta: { label: 'Major' },
    cell: ({ row }) => <Empty value={row.original.major} />,
  },
  {
    id: 'is_v1_member', header: 'Member', accessorKey: 'is_v1_member', meta: { label: 'Member' },
    cell: ({ row }) => row.original.is_v1_member ? <Tag tone="accent">Member</Tag> : dash,
  },
  {
    id: 'slack', header: 'Slack', accessorFn: (r) => r.slack_joined_at !== null,
    meta: { label: 'In Slack' },
    cell: ({ row }) => row.original.slack_joined_at ? <>Yes</> : <span className={MUTED}>No</span>,
  },
  {
    id: 'events_registered', header: 'Reg', accessorKey: 'events_registered',
    meta: { numeric: true, label: 'Events registered' },
  },
  {
    id: 'events_attended', header: 'Att', accessorKey: 'events_attended',
    meta: { numeric: true, label: 'Events attended' },
  },
  {
    id: 'ps_applications', header: 'PS apps', accessorKey: 'ps_applications',
    meta: { numeric: true, label: 'PS applications' },
  },
  {
    id: 'coffee_chats', header: 'Chats', accessorKey: 'coffee_chats',
    meta: { numeric: true, label: 'Coffee chats' },
  },
  {
    id: 'gender', header: 'Gender', accessorKey: 'gender',
    meta: { label: 'Gender', hiddenByDefault: true, sensitive: true },
    cell: ({ row }) => <Empty value={row.original.gender?.replaceAll('_', ' ')} />,
  },
  {
    id: 'uniqname', header: 'Uniqname', accessorKey: 'uniqname',
    meta: { label: 'Uniqname', hiddenByDefault: true },
    cell: ({ row }) => <Empty value={row.original.uniqname} />,
  },
  {
    id: 'notes', header: 'Notes', accessorKey: 'notes',
    meta: { label: 'Notes', hiddenByDefault: true },
    cell: ({ row }) => <span className="text-neutral-400">{row.original.notes ?? '—'}</span>,
  },
  {
    id: 'member_since', header: 'Member since', accessorKey: 'member_since',
    meta: { label: 'Member since', hiddenByDefault: true },
    cell: ({ row }) => <Empty value={row.original.member_since} />,
  },
];

/** Gender is off by default and labelled sensitive wherever it appears (spec §0.5). */
const DEFAULT_HIDDEN: Record<string, boolean> = Object.fromEntries(
  COLUMNS.filter((c) => c.meta?.hiddenByDefault).map((c) => [c.id ?? '', true]),
);

export function PeopleTable({ rows }: { rows: PersonListRow[] }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [year, setYear] = useState('');
  const [hidden, setHidden] = useState<Record<string, boolean>>(DEFAULT_HIDDEN);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setHidden(JSON.parse(saved) as Record<string, boolean>);
    } catch { /* private mode, or a stale shape — fall back to the defaults */ }
  }, []);

  const toggle = (id: string) => {
    const next = { ...hidden, [id]: !hidden[id] };
    setHidden(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const years = useMemo(
    () => [...new Set(rows.map((r) => r.grad_year).filter((y): y is number => y !== null))].sort(),
    [rows],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'members' && !r.is_v1_member) return false;
      if (filter === 'slack' && !r.slack_joined_at) return false;
      if (filter === 'no-slack' && r.slack_joined_at) return false;
      if (year !== '' && String(r.grad_year ?? '') !== year) return false;
      if (!q) return true;
      return `${fullName(r)} ${r.primary_email ?? ''} ${r.uniqname ?? ''}`.toLowerCase().includes(q);
    });
  }, [rows, search, filter, year]);

  const columns = useMemo(() => COLUMNS.filter((c) => !hidden[c.id ?? '']), [hidden]);
  const [visible, hiddenGroup] = [
    COLUMNS.filter((c) => !c.meta?.hiddenByDefault),
    COLUMNS.filter((c) => c.meta?.hiddenByDefault),
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-center gap-2">
        <input
          className="input" style={{ width: 300 }} type="search" value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, uniqname" aria-label="Search people"
        />
        <Seg
          name="people-filter" value={filter} onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'members', label: 'Members' },
            { value: 'slack', label: 'In Slack' },
            { value: 'no-slack', label: 'Not in Slack' },
          ]}
        />
        <select
          className="input" style={{ width: 150 }} value={year} onChange={(e) => setYear(e.target.value)}
          aria-label="Grad year"
        >
          <option value="">Grad year: any</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-neutral-500">{shown.length.toLocaleString()} shown</span>
          <Popover
            trigger={
              <button type="button" className="btn btn-secondary data-[state=open]:shadow-[inset_0_0_0_1px_var(--color-accent)]">
                <Columns size={16} /> Columns · {columns.length}
              </button>
            }
          >
            <div className="flex flex-col gap-[2px]">
              <div className="label-kicker pb-2">Columns</div>
              {visible.map((c) => <ColumnToggle key={c.id} column={c} hidden={hidden} onToggle={toggle} />)}
              <div className="my-[6px] h-px bg-divider" />
              <div className="pb-[6px] text-[11px] text-neutral-500">Hidden by default</div>
              {hiddenGroup.map((c) => <ColumnToggle key={c.id} column={c} hidden={hidden} onToggle={toggle} />)}
            </div>
          </Popover>
        </div>
      </div>

      <DataTable
        data={shown}
        columns={columns}
        rowHref={(r) => `/people/${r.id}`}
        empty={
          <div className="notice flex items-center gap-3 text-neutral-500">
            <UsersThree size={20} />
            {rows.length === 0
              ? 'No people yet. Import a Luma or Tally CSV to populate this table.'
              : 'No people match these filters.'}
          </div>
        }
      />
    </div>
  );
}

function ColumnToggle(
  { column, hidden, onToggle }:
  { column: ColumnDef<PersonListRow, unknown>; hidden: Record<string, boolean>; onToggle: (id: string) => void },
) {
  const id = column.id ?? '';
  return (
    <label className={`flex cursor-pointer items-center justify-between py-[5px] ${column.meta?.hiddenByDefault ? 'text-neutral-400' : ''}`}>
      <span>
        {column.meta?.label ?? id}
        {column.meta?.sensitive && <span className="ml-1 text-[10px] text-accent-300">sensitive</span>}
      </span>
      <input
        type="checkbox" className="size-[14px]" style={{ accentColor: 'var(--color-accent)' }}
        checked={!hidden[id]} onChange={() => onToggle(id)}
      />
    </label>
  );
}
