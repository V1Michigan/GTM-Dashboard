'use client';
import type { ReactNode } from 'react';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { Tag } from '@/components/ui/primitives';
import type { SlackChannelStats } from '@/lib/queries';

/** Archived channels drop to 55% opacity; the fade is per cell so the row rule keeps painting. */
const dim = (c: SlackChannelStats, node: ReactNode) =>
  <span className={c.is_archived ? 'opacity-55' : undefined}>{node}</span>;

/** A channel the bot has not joined has no counts yet — it joins at the next sync. */
const count = (c: SlackChannelStats, n: number) =>
  dim(c, c.bot_is_member || n > 0 ? n.toLocaleString() : <span className="text-neutral-600">—</span>);

const columns: ColumnDef<SlackChannelStats, unknown>[] = [
  { id: 'name', header: 'Channel', accessorFn: (c) => c.name, cell: ({ row }) => dim(row.original, `#${row.original.name}`) },
  {
    id: 'people', header: 'Active people', accessorFn: (c) => c.active_people, meta: { numeric: true },
    cell: ({ row }) => count(row.original, row.original.active_people),
  },
  {
    id: 'd7', header: '7d', accessorFn: (c) => c.messages_7d, meta: { numeric: true },
    cell: ({ row }) => count(row.original, row.original.messages_7d),
  },
  {
    id: 'd30', header: '30d', accessorFn: (c) => c.messages_30d, meta: { numeric: true },
    cell: ({ row }) => count(row.original, row.original.messages_30d),
  },
  {
    id: 'all', header: 'All time', accessorFn: (c) => c.messages_all, meta: { numeric: true },
    cell: ({ row }) => count(row.original, row.original.messages_all),
  },
  {
    id: 'bot', header: 'Bot', accessorFn: (c) => c.bot_is_member,
    cell: ({ row }) => {
      const c = row.original;
      if (c.is_archived) return dim(c, <Tag tone="neutral">archived</Tag>);
      return c.bot_is_member
        ? <Tag tone="accent">member</Tag>
        : <Tag tone="outline">joins at next sync</Tag>;
    },
  },
];

export function ChannelsTable({ channels }: { channels: SlackChannelStats[] }) {
  return (
    <DataTable
      data={channels} columns={columns}
      empty={<p className="text-[13px] text-neutral-500">No channels synced yet.</p>}
    />
  );
}
