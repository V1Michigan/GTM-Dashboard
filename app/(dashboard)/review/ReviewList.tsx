'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CaretDown, CaretRight } from '@phosphor-icons/react/dist/ssr';
import { Combobox } from '@/components/ui/Combobox';
import { KeyValues, PageHeader, Tag } from '@/components/ui/primitives';
import { Seg } from '@/components/ui/Seg';
import type { Json, PeopleDirectoryRow, ReviewItem, ReviewKind } from '@/lib/types';
import { createPeopleForNoMatch, resolveReviewItem, type ResolveInput } from './actions';

const KIND_LABEL: Record<ReviewKind, string> = {
  no_match: 'No match',
  ambiguous_match: 'Ambiguous match',
  conflict: 'Conflict',
  field_conflict: 'Field conflict',
  bad_row: 'Bad row',
};
const ORDER: ReviewKind[] = ['ambiguous_match', 'no_match', 'conflict', 'field_conflict', 'bad_row'];

/** Copy for each rung of the §3.2 ladder, used when the payload carries no reason of its own. */
const WHY: Record<ReviewKind, string> = {
  no_match: 'No person matched by email, uniqname or name.',
  ambiguous_match: 'Matched below the 0.9 auto-link threshold, so a human confirms it.',
  conflict: 'Two keys point at different people at full confidence. People are never auto-merged.',
  field_conflict: 'A field already holds a different non-null value; nulls never overwrite.',
  bad_row: 'The row could not be turned into a person.',
};

/** Ladder tokens (§3.2) as the SQL matcher writes them; anything else is already prose. */
const REASON_COPY: Record<string, string> = {
  slack_user_id: 'Slack id matches exactly',
  email: 'Email matches exactly',
  uniqname: 'Uniqname matches after normalisation',
  typo_domain_uniqname: 'Typo domain; the local part matches a uniqname',
  name_exact: 'Exact name match, one candidate',
  name_trigram: 'Name similarity (trigram)',
  conflict: 'Two keys point at different people; never auto-merged',
  new: 'No person matched by email, uniqname or name',
};
const reasonCopy = (reason: string) => REASON_COPY[reason] ?? reason;

const str = (v: Json | undefined) => (v == null || v === '' ? null : String(v));
const nameOf = (p: Record<string, Json>) =>
  [str(p.first_name), str(p.last_name)].filter(Boolean).join(' ')
  || str(p.name) || str(p.real_name) || str(p.display_name);
/** Candidate displays read "Kai Morrison · kmorr@umich.edu"; the button names just the person. */
const shortName = (display: string) => display.split(' · ')[0];

const time = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  hour12: false, timeZone: 'America/Detroit',
});

export function ReviewList({ items, people }: { items: ReviewItem[]; people: PeopleDirectoryRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<ReviewKind | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = Object.fromEntries(ORDER.map((k) => [k, 0])) as Record<ReviewKind, number>;
    items.forEach((i) => { map[i.kind] += 1; });
    return map;
  }, [items]);

  const options = useMemo(() => people.map((p) => ({
    value: p.id,
    label: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.primary_email || p.id,
    hint: p.primary_email ?? undefined,
  })), [people]);

  function resolve(input: ResolveInput) {
    setError(null);
    startTransition(async () => {
      const result = await resolveReviewItem(input);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  const shown = items.filter((i) => kind === 'all' || i.kind === kind);

  return (
    <>
      <PageHeader
        title="Review queue"
        subtitle={`${items.length} open · ${ORDER.filter((k) => counts[k])
          .map((k) => `${counts[k]} ${KIND_LABEL[k].toLowerCase()}`).join(' · ')}`}
        actions={counts.no_match > 0 && (
          <button
            type="button" className="btn btn-secondary" disabled={pending}
            onClick={() => startTransition(async () => {
              const result = await createPeopleForNoMatch();
              if (!result.ok) setError(result.error); else router.refresh();
            })}
          >
            Create new person for all {counts.no_match} no-match items
          </button>
        )}
      />

      <div className="mb-5">
        <Seg
          name="review-kind" value={kind} onChange={setKind}
          options={[
            { value: 'all' as const, label: 'All', count: items.length },
            ...ORDER.filter((k) => counts[k]).map((k) => ({ value: k, label: KIND_LABEL[k], count: counts[k] })),
          ]}
        />
      </div>

      {error && <p className="notice mb-4">{error}</p>}

      <div className="flex flex-col gap-[10px]">
        {ORDER.filter((k) => shown.some((i) => i.kind === k)).map((k) => (
          <section key={k} className="flex flex-col gap-[10px]">
            <h2 className="label-kicker pt-[6px] font-normal">
              {KIND_LABEL[k]} · {shown.filter((i) => i.kind === k).length}
            </h2>
            {shown.filter((i) => i.kind === k).map((item) => {
              const payload = item.payload;
              const open = openId === item.id && item.kind !== 'field_conflict';
              const top = item.candidates[0];
              const selected = picked[item.id] ?? top?.person_id ?? null;
              const selectedLabel = item.candidates.find((c) => c.person_id === selected)?.display
                ?? options.find((o) => o.value === selected)?.label ?? null;

              if (item.kind === 'field_conflict') {
                const field = str(payload.field) ?? 'field';
                const current = str(payload.current) ?? '—';
                const incoming = str(payload.incoming) ?? '—';
                return (
                  <div key={item.id} className="card elev-sm flex-row items-center gap-[14px] px-[18px] py-3">
                    <span className="text-[14px]">
                      {nameOf(payload) ?? 'Unknown'} · <span className="text-neutral-400">{field}</span>
                    </span>
                    <span className="text-[12.5px] text-neutral-400">
                      On record <strong className="font-medium text-text">{current}</strong> · incoming{' '}
                      <strong className="font-medium text-text">{incoming}</strong>
                    </span>
                    <span className="ml-auto flex gap-[6px]">
                      <button
                        type="button" className="btn btn-secondary px-[10px] py-[3px] text-[12px]" disabled={pending}
                        onClick={() => resolve({ itemId: item.id, action: 'field_keep' })}
                      >
                        Keep {current}
                      </button>
                      <button
                        type="button" className="btn btn-secondary px-[10px] py-[3px] text-[12px]" disabled={pending}
                        onClick={() => resolve({ itemId: item.id, action: 'field_use' })}
                      >
                        Use {incoming}
                      </button>
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={item.id}
                  className={`card ${open ? 'elev-md shadow-[0_0_0_1px_var(--color-accent-700)]' : 'elev-sm'} gap-0 p-0`}
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : item.id)}
                    aria-expanded={open}
                    className={`flex items-center gap-[14px] px-[18px] py-3 text-left ${
                      open ? 'border-b border-divider' : ''}`}
                  >
                    <span className={open ? 'text-accent' : 'text-neutral-500'} aria-hidden>
                      {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
                    </span>
                    <span className="text-[14px]">
                      {nameOf(payload) ?? 'Unknown'}
                      {str(payload.email) && <span className="text-neutral-400"> · {str(payload.email)}</span>}
                    </span>
                    {!open && (
                      <span className="text-[12.5px] text-neutral-400">
                        {top
                          ? `→ ${top.display} · ${top.confidence.toFixed(2)} · ${reasonCopy(top.reason)}`
                          : str(payload.reason) ?? WHY[item.kind]}
                      </span>
                    )}
                    {item.slack_user_id && <Tag tone="neutral">slack</Tag>}
                    <span className="ml-auto shrink-0 text-[12px] text-neutral-500">
                      {time.format(new Date(item.created_at))}
                    </span>
                  </button>

                  {open && (
                    <div className="grid" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
                      <div className="flex flex-col gap-[10px] border-r border-divider px-[18px] py-4">
                        <span className="label-kicker">Incoming payload</span>
                        <KeyValues
                          columns={1}
                          items={Object.entries(payload)
                            .filter(([key]) => !key.startsWith('_'))
                            .map(([key, value]) => [key.replace(/_/g, ' '), str(value)])}
                        />
                        <p className="m-0 text-[12px] text-neutral-500">
                          {str(payload.reason) ?? WHY[item.kind]} The email is stored as typed: linking adds it to
                          the person&rsquo;s emails, it is never rewritten.
                        </p>
                      </div>

                      <div className="flex flex-col gap-[10px] px-[18px] py-4">
                        <span className="label-kicker">Candidates</span>
                        {item.candidates.length === 0 && (
                          <p className="m-0 text-[13px] text-neutral-500">
                            No candidate people. Create a new person, or search for one.
                          </p>
                        )}
                        {item.candidates.map((c) => {
                          const on = selected === c.person_id;
                          return (
                            <label
                              key={c.person_id}
                              className={`flex cursor-pointer items-start gap-3 rounded-md bg-bg px-3 py-[10px] ${
                                on ? 'shadow-[inset_0_0_0_1px_var(--color-accent)]' : ''}`}
                            >
                              <span className="radio">
                                <input
                                  type="radio" name={`candidate-${item.id}`} checked={on}
                                  onChange={() => setPicked({ ...picked, [item.id]: c.person_id })}
                                />
                                <span className="dot" />
                              </span>
                              <span className="flex flex-1 flex-col gap-[2px] text-[13px]">
                                <span className="flex justify-between gap-3">
                                  <span>{c.display}</span>
                                  <span className={on ? 'text-accent-300' : 'text-neutral-400'}>
                                    {c.confidence.toFixed(2)}
                                  </span>
                                </span>
                                <span className="text-[12px] text-neutral-500">{reasonCopy(c.reason)}</span>
                              </span>
                            </label>
                          );
                        })}

                        {searching === item.id && (
                          <Combobox
                            options={options} value={selected} placeholder="Search people…"
                            onChange={(v) => setPicked({ ...picked, [item.id]: v })}
                          />
                        )}

                        <div className="mt-[6px] flex flex-wrap gap-2">
                          <button
                            type="button" className="btn btn-primary" disabled={pending || !selected}
                            onClick={() => resolve({ itemId: item.id, action: 'link', personId: selected })}
                          >
                            {selectedLabel ? `Link to ${shortName(selectedLabel)}` : 'Link'}
                          </button>
                          <button
                            type="button" className="btn btn-secondary"
                            onClick={() => setSearching(searching === item.id ? null : item.id)}
                          >
                            Link to other…
                          </button>
                          <button
                            type="button" className="btn btn-secondary" disabled={pending}
                            onClick={() => resolve({ itemId: item.id, action: 'create' })}
                          >
                            Create new person
                          </button>
                          <button
                            type="button" className="btn btn-secondary"
                            disabled={pending || item.candidates.length < 2 || !selected}
                            onClick={() => resolve({
                              itemId: item.id, action: 'merge', personId: selected,
                              dropId: item.candidates.find((c) => c.person_id !== selected)?.person_id,
                            })}
                          >
                            Merge candidates
                          </button>
                          <button
                            type="button" className="btn btn-ghost text-neutral-400" disabled={pending}
                            onClick={() => resolve({ itemId: item.id, action: 'dismiss' })}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}
