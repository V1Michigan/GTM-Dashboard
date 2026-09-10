'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/primitives';
import { deletePerson } from '../actions';

export interface Cascades {
  emails: number;
  attendance: number;
  submissions: number;
  applications: number;
  chats: number;
  slack: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function DeleteDialog(
  { id, name, confirmWord, cascades }:
  { id: string; name: string; confirmWord: string; cascades: Cascades },
) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const armed = typed.trim().toLowerCase() === confirmWord.toLowerCase();

  async function run() {
    setPending(true);
    const res = await deletePerson(id);
    setPending(false);
    if (res.error) setError(res.error);
    else router.push('/people');
  }

  return (
    <Dialog
      title={`Delete ${name}?`}
      trigger={
        <button type="button" className="btn btn-ghost w-full" style={{ color: 'var(--color-neutral-400)' }}>
          Delete person
        </button>
      }
      actions={
        <>
          <DialogClose asChild><button type="button" className="btn btn-ghost">Cancel</button></DialogClose>
          <button type="button" className="btn btn-secondary" disabled={!armed || pending} onClick={run}>
            {pending ? 'Deleting…' : 'Delete person'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-[10px]">
        <p className="m-0">
          This permanently removes the person and cascades to {plural(cascades.emails, 'email')},{' '}
          {plural(cascades.attendance, 'attendance row')}, {plural(cascades.submissions, 'form submission')},{' '}
          {plural(cascades.applications, 'Product Studio application')}, {plural(cascades.chats, 'coffee chat')} and{' '}
          {plural(cascades.slack, 'Slack activity row')}. It cannot be undone.
        </p>
        <p className="m-0 text-neutral-400">
          If this is a duplicate, use Merge instead so the history is kept.
        </p>
        <Field label={`Type ${confirmWord === 'delete' ? 'delete' : 'the last name'} to confirm`}>
          <input
            className="input" value={typed} placeholder={confirmWord}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>
        {error && <div className="notice">{error}</div>}
      </div>
    </Dialog>
  );
}
