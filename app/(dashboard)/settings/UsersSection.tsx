'use client';
import { useState, useTransition } from 'react';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { Empty, Tag } from '@/components/ui/primitives';
import { provisionUser, setRole } from './actions';

export interface UserRow {
  email: string;
  role: 'admin' | 'member';
  person: string | null;
  /** "Sep 8 · auto" for a row the sign-in trigger created. */
  added: string;
}

export function UsersSection({ users, me }: { users: UserRow[]; me: string }) {
  const [email, setEmail] = useState('');
  const [role, setNewRole] = useState<'admin' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
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
          There is no self sign-up. Create an account here and pass the one-time password to the
          person. Admins see everything; members can only log coffee chats.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setCreated(null);
          start(async () => {
            const result = await provisionUser({ email, role });
            if ('error' in result) { setError(result.error); return; }
            setError(null);
            setCreated({ email, password: result.password });
            setEmail('');
          });
        }}
      >
        <div className="field mb-0">
          <label htmlFor="new-user">umich.edu email</label>
          <input
            id="new-user" className="input w-[300px]" type="email" required
            placeholder="uniqname@umich.edu"
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field mb-0">
          <label htmlFor="new-role">Role</label>
          <select
            id="new-role" className="input w-[140px]" value={role}
            onChange={(e) => setNewRole(e.target.value as 'admin' | 'member')}
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending || email === ''}>
          {pending ? 'Creating…' : 'Create account'}
        </button>
      </form>

      {created && (
        <div className="notice flex flex-col gap-2">
          <div className="text-[13px] font-medium">Account created for {created.email}</div>
          <div className="text-[12.5px] text-neutral-400">
            Give them this one-time password. It is not stored anywhere and cannot be shown again —
            copy it now.
          </div>
          <code className="rounded-sm bg-[var(--color-bg)] px-3 py-2 font-mono text-[13px] text-accent-300">
            {created.password}
          </code>
        </div>
      )}

      {error && <div className="notice">{error}</div>}

      <DataTable
        data={users} columns={columns}
        empty={<p className="text-[13px] text-neutral-500">No users yet.</p>}
      />
    </div>
  );
}
