import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { revalidate, tags } from '@/lib/cache';
import { applyMapping, fileHash, parseCsv, rowHash } from '@/lib/imports/parse';
import type { ParsedRow } from '@/lib/imports/schemas';
import { addPersonToIndex, buildPersonIndex, matchPerson } from '@/lib/matching/matchPerson';
import { fetchAll } from '@/lib/paginate';

interface PersonRow {
  id: string; first_name: string | null; last_name: string | null;
  uniqname: string | null; slack_user_id: string | null;
}
interface EmailRow { person_id: string; email: string; is_primary: boolean }
import type { ImportRowStatus, Json } from '@/lib/types';

/**
 * How this stays a *dry* run: PostgREST gives a route handler no transaction to
 * roll back, so rather than pretend, this writes only `import_rows` — the staging
 * table — and leaves the import at `parsed`. No target table is touched;
 * `apply_import` at commit is the only thing that writes people, events or
 * attendance. Re-running replaces the staged rows, so it is idempotent.
 */

const Body = z.object({
  import_id: z.uuid(),
  mapping: z.record(z.string(), z.string()),
  save_mapping: z.boolean().default(false),
});

export interface PreviewRow {
  row: number;
  incoming: string;
  /** Why the row landed here, in §3.2's words, or the parse error it failed with. */
  reason: string;
  candidate: string | null;
  confidence: number | null;
}

export interface DryRunResult {
  counts: { rows: number; new: number; updated: number; unchanged: number; review: number; bad: number };
  review: PreviewRow[];
  autoLinked: PreviewRow[];
  bad: PreviewRow[];
}

interface Staged {
  import_id: string;
  row_index: number;
  raw: Record<string, string>;
  parsed: ParsedRow | null;
  row_hash: string;
  person_id: string | null;
  match_confidence: number | null;
  status: ImportRowStatus;
  error: string | null;
}

/** Ids for people this file will create; they exist only for the preview's own index. */
const pendingId = (row: number) => `pending:${row}`;
const isPending = (id: string) => id.startsWith('pending:');

/** Bots and deactivated accounts are not people (§8.4); apply_import_row drops them. */
const isSkippedSlackAccount = (row: ParsedRow) =>
  ['bot', 'deactivated'].includes((row.slack_status ?? '').toLowerCase())
  || (row.email_normalized ?? '').endsWith('@slack-bots.com');

/** The §3.2 ladder rungs in the operator's words; the wizard prints these as-is. */
const REASON_COPY: Record<string, string> = {
  slack_user_id: 'Slack id matches exactly',
  email: 'Email matches exactly',
  uniqname: 'Uniqname matches after normalisation',
  typo_domain_uniqname: 'Typo domain; the local part matches a uniqname',
  name_exact: 'Exact name match, one candidate',
  name_trigram: 'Name similarity (trigram)',
  conflict: 'Email and Slack id point at different people; never auto-merged',
  new: 'No person matched by email, uniqname or name',
};

const fullName = (first: string | null, last: string | null) =>
  [first, last].filter(Boolean).join(' ') || null;
/** "Kai Morrison · kmorr@umich.efu" — the one-line identity every preview list shows. */
const describe = (name: string | null, email: string | null) =>
  [name, email].filter(Boolean).join(' · ') || '(blank row)';

export async function POST(req: Request) {
  await requireAdmin();
  const db = await createServerClient();

  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const { import_id, mapping, save_mapping } = body.data;

  const { data: record } = await db.from('imports').select('*').eq('id', import_id).maybeSingle();
  if (!record?.storage_path) return NextResponse.json({ error: 'Import not found.' }, { status: 404 });

  const download = await db.storage.from('imports').download(record.storage_path.replace('imports/', ''));
  if (download.error || !download.data) {
    return NextResponse.json({ error: 'The stored file could not be read.' }, { status: 500 });
  }
  const { rows } = parseCsv(await download.data.text());

  // Everything matching needs, in three queries: the people index the TS mirror of
  // the ladder reads, and the hashes already applied for this (kind, event).
  const priorQuery = db.from('imports').select('id').eq('kind', record.kind);
  // Paged: an unbounded select stops at 1000 rows, which would hide most of the
  // database from the matcher and report everyone as a new person.
  const [people, emails, prior] = await Promise.all([
    fetchAll<PersonRow>((f, t) => db.from('people')
      .select('id,first_name,last_name,uniqname,slack_user_id').order('id').range(f, t)),
    fetchAll<EmailRow>((f, t) => db.from('person_emails')
      .select('person_id,email,is_primary').order('person_id').order('email').range(f, t)),
    record.event_id ? priorQuery.eq('event_id', record.event_id) : priorQuery.is('event_id', null),
  ]);

  const byPerson = new Map<string, { email: string; is_primary: boolean }[]>();
  for (const row of emails) {
    byPerson.set(row.person_id, [...(byPerson.get(row.person_id) ?? []), row]);
  }
  const index = buildPersonIndex(people.map((p) => {
    const mine = byPerson.get(p.id) ?? [];
    const name = fullName(p.first_name, p.last_name);
    const primary = (mine.find((e) => e.is_primary) ?? mine[0])?.email ?? null;
    return {
      id: p.id,
      display: describe(name, primary),
      emails: mine.map((e) => e.email),
      uniqname: p.uniqname,
      name,
      slackUserId: p.slack_user_id,
    };
  }));

  const priorIds = (prior.data ?? []).map((r) => r.id).filter((id) => id !== import_id);
  // Paged for the same reason as the index: a prior import of a few thousand rows
  // would otherwise contribute only its first 1000 hashes, and the preview would
  // call already-applied rows new.
  const applied = priorIds.length
    ? await fetchAll<{ row_hash: string }>((f, t) => db.from('import_rows')
        .select('row_hash').eq('status', 'applied').in('import_id', priorIds)
        .order('row_hash').range(f, t))
    : [];
  const seen = new Set(applied.map((r) => r.row_hash));

  const review: PreviewRow[] = [];
  const autoLinked: PreviewRow[] = [];
  const bad: PreviewRow[] = [];

  const staged: Staged[] = rows.map((raw, i) => {
    const row_index = i + 1;
    const base = { import_id, row_index, raw, person_id: null, match_confidence: null };

    let parsed: ParsedRow;
    try {
      parsed = applyMapping(raw, mapping, record.kind).parsed;
    } catch (e) {
      const reason = e instanceof z.ZodError
        ? e.issues[0]?.message ?? 'Row does not parse'
        : (e as Error).message;
      bad.push({ row: row_index, incoming: describe(null, String(raw.email ?? raw.Email ?? '')), reason, candidate: null, confidence: null });
      return {
        ...base, parsed: null, status: 'failed',
        row_hash: fileHash(new TextEncoder().encode(JSON.stringify(raw))),
        error: `bad_row: ${reason}`,
      };
    }

    const name = fullName(parsed.first_name, parsed.last_name);
    const who = describe(name, parsed.email);
    const hash = rowHash(parsed);
    const staged = { ...base, parsed, row_hash: hash };

    // §4.8: test rows are marked and skipped; the commit step can override.
    if (parsed.is_test_row) {
      bad.push({ row: row_index, incoming: who, reason: 'Test row (name or domain)', candidate: null, confidence: null });
      return { ...staged, status: 'failed', error: 'bad_row: test row' };
    }
    if (seen.has(hash)) return { ...staged, status: 'skipped_unchanged', error: null };

    // Mirror of the filter in apply_import_row: §8.4 syncs only non-bot,
    // non-deleted users. Predicted here too, or the preview would promise to
    // create ~26 people the commit is going to skip.
    if (record.kind === 'slack_members' && isSkippedSlackAccount(parsed)) {
      return { ...staged, status: 'skipped_unchanged', error: null };
    }

    const match = matchPerson(
      { email: parsed.email, name, uniqname: parsed.uniqname, slackUserId: parsed.slack_user_id },
      index,
    );
    const line: PreviewRow = {
      row: row_index,
      incoming: who,
      reason: REASON_COPY[match.reason] ?? match.reason,
      candidate: match.candidates[0]?.display ?? null,
      confidence: match.candidates.length ? match.confidence : null,
    };

    if (match.personId && match.confidence >= 0.9) {
      // A 1.00 email or Slack hit needs no explaining; a lower auto-link is the
      // uniqname rung, which the operator should see before committing.
      if (match.confidence < 1) autoLinked.push(line);
      // A pending id belongs to a row earlier in this same file, not to a row in
      // the database, so it must not be written to import_rows.person_id.
      const personId = isPending(match.personId) ? null : match.personId;
      return { ...staged, person_id: personId, match_confidence: match.confidence, status: 'pending', error: null };
    }
    if (match.candidates.length > 0) {
      review.push(line);
      return { ...staged, match_confidence: match.confidence, status: 'review', error: null };
    }
    // This row will create a person, so later rows in the same file can match it.
    addPersonToIndex(index, {
      id: pendingId(row_index),
      display: who,
      name,
      emails: parsed.email ? [parsed.email] : [],
      uniqname: parsed.uniqname,
      slackUserId: parsed.slack_user_id,
    });
    return { ...staged, status: 'pending', error: null };
  });

  await db.from('import_rows').delete().eq('import_id', import_id);
  const insert = await db.from('import_rows').insert(
    staged.map((r) => ({ ...r, parsed: r.parsed as unknown as Json })),
  );
  if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 500 });

  const counts: DryRunResult['counts'] = {
    rows: staged.length,
    new: staged.filter((r) => r.status === 'pending' && !r.person_id).length,
    updated: staged.filter((r) => r.status === 'pending' && r.person_id).length,
    unchanged: staged.filter((r) => r.status === 'skipped_unchanged').length,
    review: staged.filter((r) => r.status === 'review').length,
    bad: bad.length,
  };

  await db.from('imports').update({
    column_mapping: mapping, status: 'parsed', row_count: counts.rows,
    rows_new: counts.new, rows_updated: counts.updated, rows_unchanged: counts.unchanged,
    rows_review: counts.review, rows_failed: counts.bad, error: null,
  }).eq('id', import_id);

  if (save_mapping) {
    await db.from('saved_column_mappings')
      .upsert({ source: record.source, kind: record.kind, mapping, updated_at: new Date().toISOString() });
  }

  revalidate(tags.imports);
  return NextResponse.json({ counts, review, autoLinked, bad } satisfies DryRunResult);
}
