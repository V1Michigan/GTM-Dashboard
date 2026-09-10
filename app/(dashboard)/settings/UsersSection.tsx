'use client';
import { useState, useTransition } from 'react';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { Empty, Tag } from '@/components/ui/primitives';
import { addAdmin, setRole } from './actions';

export interface UserRow {
  email: string;
  role: 'admin' | 'member';
  person: string | null;
  /** "Sep 8 · auto" for a row the sign-in trigger created. */
  added: string;
}

export function UsersSection({ users, me }: { users: UserRow[]; me: string }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<string | null>) =>
    start(async () => setError(await fn()));

  const columns: ColumnDef<UserRow, unknown>[] = [
    { id: 'email', header: 'Email', accessorFn: (u) => u.email },
    {
      id: 'role', header: 'Role', accessorFn: (u) => u.role,
      cell: ({ row }) => (
        <Tag tone={row.original.role === 'admin' ? 'accent' : 'neutral'}>{row.original.role}</Tag>
      ),
    },
    {
      id: 'person', header: 'Linked person', accessorFn: (u) => u.person ?? '',
      cell: ({ row }) => <span className="text-neutral-400"><Empty value={row.original.person} /></span>,
    },
    {
      id: 'added', header: 'Added', accessorFn: (u) => u.added,
      cell: ({ row }) => <span className="text-neutral-500">{row.original.added}</span>,
    },
    {
      id: 'action', header: '', enableSorting: false,
      cell: ({ row }) => {
        const u = row.original;
        if (u.email.toLowerCase() === me.toLowerCase()) {
          return <span className="block text-right text-[12px] text-neutral-600">you</span>;
        }
        const next = u.role === 'admin' ? 'member' : 'admin';
        return (
          <span className="block text-right">
            <button
              type="button" className="btn btn-ghost text-[12px]" disabled={pending}
              onClick={() => run(() => setRole({ email: u.email, role: next }))}
            >
              {next === 'admin' ? 'Promote' : 'Demote'}
            </button>
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="mb-[2px] text-[17px]">Users &amp; roles</h2>
        <p className="m-0 text-[13px] text-neutral-400">
          Admins see everything. Members are created automatically on first sign-in and can only
          log coffee chats.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const message = await addAdmin(email);
            if (!message) setEmail('');
            return message;
          });
        }}
      >
        <input
          className="input w-[300px]" type="email" placeholder="uniqname@umich.edu"
          aria-label="Add an admin by email" value={email} onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={pending || email === ''}>
          Add admin
        </button>
      </form>

      {error && <div className="notice">{error}</div>}

      <DataTable
        data={users} columns={columns}
        empty={<p className="text-[13px] text-neutral-500">No users yet.</p>}
      />
    </div>
  );
}
