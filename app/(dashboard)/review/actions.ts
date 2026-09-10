'use server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { revalidate, tags } from '@/lib/cache';
import { normalizeEmail } from '@/lib/matching/normalize';
import { createServerClient } from '@/lib/supabase/server';
import type { Json, ReviewItem } from '@/lib/types';

const Input = z.object({
  itemId: z.uuid(),
  action: z.enum(['link', 'create', 'merge', 'dismiss', 'field_keep', 'field_use']),
  personId: z.uuid().nullish(),
  dropId: z.uuid().nullish(),
});
export type ResolveInput = z.input<typeof Input>;
export type ResolveResult = { ok: true } | { ok: false; error: string };

const str = (v: Json | undefined) => (v == null || v === '' ? null : String(v));
const splitName = (full: string | null): [string | null, string | null] => {
  if (!full) return [null, null];
  const cut = full.trim().lastIndexOf(' ');
  return cut === -1 ? [full.trim(), null] : [full.slice(0, cut).trim(), full.slice(cut + 1).trim()];
};

type Db = Awaited<ReturnType<typeof createServerClient>>;

/**
 * Slack-origin items have no import row to re-apply, so linking is done here:
 * the person takes the Slack id, the Slack email joins their emails, and the
 * message counts buffered while they were unmatched are flushed into
 * slack_channel_activity (spec §8.3).
 */
async function resolveSlack(db: Db, item: ReviewItem, personId: string) {
  const payload = item.payload;
  await db.from('people').update({
    slack_user_id: item.slack_user_id,
    slack_joined_at: str(payload.joined_at) ?? new Date().toISOString(),
  }).eq('id', personId);

  const email = str(payload.email);
  if (email) {
    await db.from('person_emails')
      .upsert(
        { person_id: personId, email, email_normalized: normalizeEmail(email), source: 'slack' },
        { onConflict: 'email_normalized', ignoreDuplicates: true },
      );
  }

  const { data: unmatched } = await db.from('slack_unmatched_users')
    .select('pending_message_counts').eq('slack_user_id', item.slack_user_id!).maybeSingle();
  const pending = (unmatched?.pending_message_counts ?? {}) as Record<string, Record<string, number>>;
  const activity = Object.entries(pending).flatMap(([channel_id, days]) =>
    Object.entries(days).map(([activity_date, message_count]) => ({
      person_id: personId, channel_id, activity_date, message_count,
    })));
  if (activity.length) await db.from('slack_channel_activity').upsert(activity);
  await db.from('slack_unmatched_users').delete().eq('slack_user_id', item.slack_user_id!);
}

export async function resolveReviewItem(raw: ResolveInput): Promise<ResolveResult> {
  const session = await requireAdmin();
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Invalid resolution.' };
  const { itemId, action, personId, dropId } = parsed.data;

  const db = await createServerClient();
  const { data } = await db.from('review_items').select('*').eq('id', itemId).maybeSingle();
  const item = data as ReviewItem | null;
  if (!item) return { ok: false, error: 'Review item not found.' };

  let target = personId ?? null;

  if (action !== 'dismiss' && action !== 'field_keep') {
    if (action === 'merge') {
      if (!target || !dropId) return { ok: false, error: 'Merge needs two people.' };
      const { error } = await db.rpc('merge_people', { keep_id: target, drop_id: dropId });
      if (error) return { ok: false, error: error.message };
    }

    if (item.import_row_id) {
      // Person creation and every merge rule stay in SQL: a null person_id tells
      // apply_import_row to create the person exactly as a fresh import would.
      await db.from('import_rows').update({
        person_id: action === 'create' ? null : target,
        status: 'pending', error: null,
      }).eq('id', item.import_row_id);
      const { error } = await db.rpc('apply_import_row', {
        p_import_row_id: item.import_row_id,
        p_incoming_wins: action === 'field_use',
      });
      if (error) return { ok: false, error: error.message };
    } else if (item.slack_user_id) {
      if (action === 'create') {
        const [first, last] = splitName(str(item.payload.real_name) ?? str(item.payload.display_name));
        const { data: created, error } = await db.from('people')
          .insert({ first_name: first, last_name: last }).select('id').single();
        if (error || !created) return { ok: false, error: error?.message ?? 'Could not create person.' };
        target = created.id;
      }
      if (!target) return { ok: false, error: 'Pick a person to link.' };
      await resolveSlack(db, item, target);
    }
  }

  const { error } = await db.from('review_items').update({
    status: action === 'dismiss' ? 'dismissed' : 'resolved',
    resolution: { action, person_id: target, drop_id: dropId ?? null },
    resolved_by: session.userId,
    resolved_at: new Date().toISOString(),
  }).eq('id', itemId);
  if (error) return { ok: false, error: error.message };

  revalidate(
    tags.review, tags.people, tags.imports, tags.events, tags.overview, tags.slack,
    ...(target ? [tags.person(target)] : []),
  );
  return { ok: true };
}

/** Header bulk action: every open `no_match` item becomes a new person. */
export async function createPeopleForNoMatch(): Promise<ResolveResult> {
  await requireAdmin();
  const db = await createServerClient();
  const { data } = await db.from('review_items').select('id')
    .eq('status', 'open').eq('kind', 'no_match');
  for (const { id } of data ?? []) {
    const result = await resolveReviewItem({ itemId: id, action: 'create' });
    if (!result.ok) return result;
  }
  return { ok: true };
}
