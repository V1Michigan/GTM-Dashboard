'use client';
import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Combobox } from '@/components/ui/Combobox';
import { Field } from '@/components/ui/primitives';
import { deleteCoffeeChat, logCoffeeChat } from './actions';

export interface DirectoryOption { id: string; name: string; email: string | null }
export interface RecentChat { id: string; name: string; when: string; deletable: boolean }

/**
 * One form for both variants of `/coffee-chats/log`: the member's phone view
 * (member fixed to current_person_id(), 44px targets) and the admin desktop
 * view (member selectable). Nothing else differs.
 */
export function LogForm({
  people, members, recent, today, compact,
}: {
  people: DirectoryOption[];
  /** null for the `member` role — the SQL function fixes member_id. */
  members: DirectoryOption[] | null;
  recent: RecentChat[];
  today: string;
  compact: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [personId, setPersonId] = useState<string | null>(null);
  const [newPerson, setNewPerson] = useState<{ name: string; email: string } | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [chattedOn, setChattedOn] = useState(today);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const tall = compact ? 'min-h-[44px] text-[15px]' : '';
  const toOption = (p: DirectoryOption) => ({ value: p.id, label: p.name, hint: p.email ?? undefined });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const message = await logCoffeeChat({
        personId, newPerson, memberId, chattedOn, notes: notes.trim() || null,
      });
      if (message) { setError(message); return; }
      setPersonId(null); setNewPerson(null); setNotes(''); setChattedOn(today);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <form onSubmit={submit} className="flex flex-col gap-[18px]">
        {members && (
          <Field label="Member who did the chat">
            <Combobox
              options={members.map(toOption)} value={memberId} onChange={setMemberId}
              placeholder="Search members"
            />
          </Field>
        )}

        <Field label="Who did you chat with?">
          <Combobox
            options={people.map(toOption)}
            value={personId}
            onChange={(v) => { setPersonId(v); setNewPerson(null); }}
            placeholder="Search name or email"
            onCreate={(q) => { setPersonId(null); setNewPerson({ name: q, email: '' }); }}
            createLabel={(q) => `+ Add “${q}” as a new person`}
          />
        </Field>

        {newPerson && (
          <div className="flex flex-col gap-[10px] rounded-md border border-dashed border-accent-800 px-[14px] py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] uppercase tracking-[0.08em] text-accent-300">Add person</span>
              <button type="button" className="btn btn-ghost text-[12px]" onClick={() => setNewPerson(null)}>
                Cancel
              </button>
            </div>
            <div className="field">
              <label htmlFor={`${uid}-name`}>Name</label>
              <input
                id={`${uid}-name`} className={`input ${tall}`} value={newPerson.name} required
                onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={`${uid}-email`}>Email</label>
              <input
                id={`${uid}-email`} type="email" className={`input ${tall}`} value={newPerson.email} required
                onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })}
              />
            </div>
            <div className="text-[12px] text-neutral-500">
              An admin will confirm this person. Your chat is saved right away.
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor={`${uid}-date`}>Date</label>
          <input
            id={`${uid}-date`} type="date" className={`input ${tall}`} value={chattedOn} required
            max={today} onChange={(e) => setChattedOn(e.target.value)}
          />
          {chattedOn === today && <div className="mt-1 text-[11px] text-neutral-500">Today</div>}
        </div>

        <div className="field">
          <label htmlFor={`${uid}-notes`}>Notes (optional)</label>
          <textarea
            id={`${uid}-notes`} className={`input ${compact ? 'min-h-[72px] text-[15px]' : 'min-h-[80px]'}`}
            value={notes} onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && <div className="notice">{error}</div>}

        {compact ? (
          <button type="submit" className="btn btn-primary btn-block min-h-[48px] text-[15px]" disabled={pending}>
            {pending ? 'Saving…' : 'Save coffee chat'}
          </button>
        ) : (
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => router.back()}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save coffee chat'}
            </button>
          </div>
        )}
      </form>

      {recent.length > 0 && (
        <section className="mt-[6px] flex flex-col gap-2">
          <h2 className="label-kicker">Your recent chats</h2>
          {recent.map((c, i) => (
            <div
              key={c.id}
              className={`flex items-center justify-between gap-3 py-[10px] text-[14px] ${
                i < recent.length - 1 ? 'border-b border-divider' : ''
              }`}
            >
              <span>
                {c.name}
                <br />
                <span className="text-[12px] text-neutral-500">{c.when}</span>
              </span>
              {c.deletable ? (
                <button
                  type="button" disabled={pending}
                  className="btn btn-ghost min-h-[44px] text-[13px] text-neutral-400"
                  onClick={() => start(async () => {
                    const message = await deleteCoffeeChat(c.id);
                    if (message) setError(message); else router.refresh();
                  })}
                >
                  Delete
                </button>
              ) : (
                <span className="pr-[10px] text-[12px] text-neutral-600">locked</span>
              )}
            </div>
          ))}
          <div className="text-[11.5px] text-neutral-600">
            Chats can be deleted for 24 hours after logging.
          </div>
        </section>
      )}
    </div>
  );
}
