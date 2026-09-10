'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Combobox } from '@/components/ui/Combobox';
import { Field } from '@/components/ui/primitives';
import type { PeopleDirectoryRow } from '@/lib/types';
import { mergePerson } from '../actions';

export interface MergeSummary {
  id: string;
  name: string;
  emails: number;
  events: number;
  applications: number;
  createdOn: string;
}

export function MergeDialog(
  { drop, directory }: { drop: MergeSummary; directory: PeopleDirectoryRow[] },
) {
  const router = useRouter();
  const [keepId, setKeepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const options = directory
    .filter((p) => p.id !== drop.id)
    .map((p) => ({
      value: p.id,
      label: [p.first_name, p.last_name].filter(Boolean).join(' ') || '(no name)',
      hint: p.primary_email ?? undefined,
    }));
  const keep = options.find((o) => o.value === keepId);

  async function run() {
    if (!keepId) return;
    setPending(true);
    const res = await mergePerson(keepId, drop.id);
    setPending(false);
    if (res.error) setError(res.error);
    else router.push(`/people/${keepId}`);
  }

  return (
    <Dialog
      title="Merge into another person"
      trigger={<button type="button" className="btn btn-secondary w-full">Merge into another person</button>}
      actions={
        <>
          <DialogClose asChild><button type="button" className="btn btn-ghost">Cancel</button></DialogClose>
          <button type="button" className="btn btn-primary" disabled={!keepId || pending} onClick={run}>
            {pending ? 'Merging…' : 'Merge people'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0">
          Everything on <strong className="font-medium text-text">{drop.name}</strong> — emails,
          attendance, form submissions, Product Studio applications, coffee chats and Slack
          activity — moves to the person you keep. Non-null fields on the kept person win; its
          blanks are filled in from {drop.name}. The merge is logged to{' '}
          <code className="text-[12px]">person_merges</code> and {drop.name} is then deleted.
        </p>

        <Field label="Keep">
          <Combobox
            options={options} value={keepId} onChange={setKeepId}
            placeholder="Search people by name or email"
          />
        </Field>

        <div className="grid grid-cols-2 gap-[10px] text-[12.5px]">
          <div className="rounded-md bg-bg px-3 py-[10px]">
            <div className="mb-[6px] text-[10px] uppercase tracking-[0.08em] text-accent">Keep</div>
            {keep ? (
              <>
                {keep.label}<br />
                <span className="text-neutral-500">{keep.hint ?? 'no email on file'}</span>
              </>
            ) : (
              <span className="text-neutral-500">Choose the person to keep</span>
            )}
          </div>
          <div className="rounded-md bg-bg px-3 py-[10px] opacity-75">
            <div className="mb-[6px] text-[10px] uppercase tracking-[0.08em] text-neutral-500">Drop</div>
            {drop.name}<br />
            <span className="text-neutral-500">
              {drop.emails} email{drop.emails === 1 ? '' : 's'} · {drop.events} event
              {drop.events === 1 ? '' : 's'} · {drop.applications} PS app
              {drop.applications === 1 ? '' : 's'} · created {drop.createdOn}
            </span>
          </div>
        </div>

        {error && <div className="notice">{error}</div>}
      </div>
    </Dialog>
  );
}
