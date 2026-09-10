'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle } from '@phosphor-icons/react/dist/ssr';
import { Combobox } from '@/components/ui/Combobox';
import { KeyValues, PageHeader, Tag } from '@/components/ui/primitives';
import { Seg } from '@/components/ui/Seg';
import { fmtDateTime } from '@/lib/format';
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
/** person_display() writes "Kai Morrison <kmorr@umich.edu>"; the button names just the person. */
const shortName = (display: string) =>
  display.replace(/\s*<[^>]*>\s*$/, '').trim() || display;

export function ReviewQueue({ items, people }: { items: ReviewItem[]; people: PeopleDirectoryRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<ReviewKind | 'all'>('all');
  /*
   * Resolved ids are held locally so the next item appears the instant the
   * action returns. router.refresh() still runs, but the queue does not wait for
   * the round trip — and because `remaining` is derived from the server list
   * minus these ids, the refresh cannot double-count or resurrect an item.
   */
  const [done, setDone] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = Object.fromEntries(ORDER.map((k) => [k, 0])) as Record<ReviewKind, number>;
    items.forEach((i) => { if (!done.has(i.id)) map[i.kind] += 1; });
    return map;
  }, [items, done]);

  const remaining = useMemo(
    () => items.filter((i) => !done.has(i.id) && (kind === 'all' || i.kind === kind)),
    [items, done, kind],
  );

  // Resolving shrinks `remaining`, so the same cursor lands on the next item.
  // Skipping past the end wraps, which is what makes it a queue rather than a list.
  useEffect(() => {
    if (cursor >= remaining.length) setCursor(0);
  }, [cursor, remaining.length]);

  const options = useMemo(() => people.map((p) => ({
    value: p.id,
    label: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.primary_email || p.id,
    hint: p.primary_email ?? undefined,
  })), [people]);

  const item = remaining[Math.min(cursor, Math.max(remaining.length - 1, 0))];
  const total = items.filter((i) => !done.has(i.id)).length;

  function resolve(input: ResolveInput) {
    setError(null);
    startTransition(async () => {
      const result = await resolveReviewItem(input);
      if (!result.ok) { setError(result.error); return; }
      setDone((prev) => new Set(prev).add(input.itemId));
      setSearching(false);
      router.refresh();
    });
  }

  if (!item) {
    return (
      <>
        <PageHeader title="Review queue" subtitle="0 open" />
        <div className="card elev-sm max-w-[560px] items-start gap-3 p-12">
          <CheckCircle size={28} className="text-accent" />
          <h2 className="m-0 text-[18px]">Queue is clear</h2>
          <p className="m-0 text-[14px] text-neutral-400">
            Every import row and Slack user has been matched. New items appear here when an import,
            webhook or Slack event can&rsquo;t be linked with confidence.
          </p>
        </div>
      </>
    );
  }

  const payload = item.payload;
  const top = item.candidates[0];
  const selected = picked[item.id] ?? top?.person_id ?? null;
  const selectedLabel = item.candidates.find((c) => c.person_id === selected)?.display
    ?? options.find((o) => o.value === selected)?.label ?? null;
  const position = remaining.indexOf(item) + 1;

  return (
    <>
      <PageHeader
        title="Review queue"
        subtitle={`${total} open · ${ORDER.filter((k) => counts[k])
          .map((k) => `${counts[k]} ${KIND_LABEL[k].toLowerCase()}`).join(' · ')}`}
        actions={counts.no_match > 0 && (
          <button
            type="button" className="btn btn-secondary" disabled={pending}
            onClick={() => startTransition(async () => {
              const result = await createPeopleForNoMatch();
              if (!result.ok) setError(result.error);
              else { setDone(new Set(items.map((i) => i.id))); router.refresh(); }
            })}
          >
            Create new person for all {counts.no_match} no-match items
          </button>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Seg
          name="review-kind"
          value={kind}
          onChange={(k) => { setKind(k); setCursor(0); }}
          options={[
            { value: 'all' as const, label: 'All', count: total },
            ...ORDER.filter((k) => counts[k]).map((k) => ({ value: k, label: KIND_LABEL[k], count: counts[k] })),
          ]}
        />
        <span className="text-[12px] text-neutral-500">{position} of {remaining.length}</span>
        <div className="h-[3px] w-[160px] overflow-hidden rounded-full bg-neutral-800" aria-hidden>
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: `${(position / Math.max(remaining.length, 1)) * 100}%` }}
          />
        </div>
        <button
          type="button" className="btn btn-ghost ml-auto text-[13px]" disabled={pending || remaining.length < 2}
          onClick={() => setCursor((c) => (c + 1) % remaining.length)}
        >
          Skip <ArrowRight size={14} />
        </button>
      </div>

      {error && <p className="notice mb-4">{error}</p>}

      <article
        key={item.id}
        className="card elev-md max-w-[980px] gap-0 p-0 shadow-[0_0_0_1px_var(--color-accent-700)]"
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-divider px-6 py-4">
          <Tag tone={item.kind === 'field_conflict' || item.kind === 'bad_row' ? 'neutral' : 'outline'}>
            {KIND_LABEL[item.kind]}
          </Tag>
          <span className="text-[17px]">{nameOf(payload) ?? 'Unknown'}</span>
          {str(payload.email) && <span className="text-[13px] text-neutral-400">{str(payload.email)}</span>}
          {item.slack_user_id && <Tag tone="neutral">slack</Tag>}
          <span className="ml-auto text-[12px] text-neutral-500">{fmtDateTime(item.created_at)}</span>
        </header>

        {item.kind === 'field_conflict' ? (
          <FieldConflict item={item} pending={pending} onResolve={resolve} />
        ) : (
          <div className="grid" style={{ gridTemplateColumns: '1fr 1.25fr' }}>
            <div className="flex flex-col gap-3 border-r border-divider px-6 py-5">
              <span className="label-kicker">Incoming</span>
              <KeyValues
                columns={1}
                items={Object.entries(payload)
                  .filter(([key]) => !key.startsWith('_'))
                  .map(([key, value]) => [key.replace(/_/g, ' '), str(value)])}
              />
              <p className="m-0 text-[12px] text-neutral-500">
                {str(payload.reason) ?? WHY[item.kind]} The email is stored as typed: linking adds it
                to the person&rsquo;s emails, it is never rewritten.
              </p>
            </div>

            <div className="flex flex-col gap-3 px-6 py-5">
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

              {searching && (
                <Combobox
                  options={options} value={selected} placeholder="Search people…"
                  onChange={(v) => setPicked({ ...picked, [item.id]: v })}
                />
              )}

              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button" className="btn btn-primary" disabled={pending || !selected}
                  onClick={() => resolve({ itemId: item.id, action: 'link', personId: selected })}
                >
                  {selectedLabel ? `Link to ${shortName(selectedLabel)}` : 'Link'}
                </button>
                <button
                  type="button" className="btn btn-secondary"
                  onClick={() => setSearching((s) => !s)}
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
      </article>

      {remaining.length > 1 && (
        <p className="mt-3 max-w-[980px] text-[12px] text-neutral-500">
          Next: {nameOf(remaining[(remaining.indexOf(item) + 1) % remaining.length]!.payload) ?? 'Unknown'}
          {' · '}{KIND_LABEL[remaining[(remaining.indexOf(item) + 1) % remaining.length]!.kind]}
        </p>
      )}
    </>
  );
}

/** A binary choice needs no candidate list — just the two values, side by side. */
function FieldConflict(
  { item, pending, onResolve }:
  { item: ReviewItem; pending: boolean; onResolve: (input: ResolveInput) => void },
) {
  const field = str(item.payload.field) ?? 'field';
  const current = str(item.payload.current) ?? '—';
  const incoming = str(item.payload.incoming) ?? '—';
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <span className="label-kicker">{field.replace(/_/g, ' ')}</span>
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {([['On record', current, 'field_keep'], ['Incoming', incoming, 'field_use']] as const).map(
          ([label, value, action]) => (
            <div key={action} className="flex flex-col gap-2 rounded-md bg-bg px-4 py-3">
              <span className="label-kicker">{label}</span>
              <span className="text-[15px]">{value}</span>
              <button
                type="button" className="btn btn-secondary mt-1" disabled={pending}
                onClick={() => onResolve({ itemId: item.id, action })}
              >
                {action === 'field_keep' ? 'Keep this' : 'Use this'}
              </button>
            </div>
          ),
        )}
      </div>
      <p className="m-0 text-[12px] text-neutral-500">{WHY.field_conflict}</p>
    </div>
  );
}
