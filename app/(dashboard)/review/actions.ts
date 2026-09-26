'use server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { revalidate, tags } from '@/lib/cache';
import { createServerClient } from '@/lib/supabase/server';

const Input = z.object({
  itemId: z.uuid(),
  action: z.enum(['link', 'create', 'merge', 'dismiss', 'field_keep', 'field_use']),
  personId: z.uuid().nullish(),
  dropId: z.uuid().nullish(),
});
export type ResolveInput = z.input<typeof Input>;
export type ResolveResult = { ok: true } | { ok: false; error: string };

/**
 * One decision, one round trip: resolve_review_item() does the whole thing in
 * a single transaction. No revalidation here on purpose — in a Server Action
 * that makes Next re-render /review into the response, refetching every open
 * item and the people directory on every click. The queue calls
 * `finishReview()` once when it goes idle instead.
 */
export async function resolveReviewItem(raw: ResolveInput): Promise<ResolveResult> {
  await requireAdmin();
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Invalid resolution.' };
  const { itemId, action, personId, dropId } = parsed.data;

  const db = await createServerClient();
  const { error } = await db.rpc('resolve_review_item', {
    p_item_id: itemId, p_action: action, p_person_id: personId ?? null, p_drop_id: dropId ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Header bulk action: every open `no_match` item becomes a new person, in one call. */
export async function createPeopleForNoMatch(): Promise<ResolveResult> {
  await requireAdmin();
  const db = await createServerClient();
  const { error } = await db.rpc('create_people_for_no_match');
  if (error) return { ok: false, error: error.message };
  await finishReview();
  return { ok: true };
}

/** Everything a review decision can change. Called once per burst of decisions. */
export async function finishReview(): Promise<void> {
  await requireAdmin();
  revalidate(tags.review, tags.people, tags.imports, tags.events, tags.overview, tags.slack);
}
