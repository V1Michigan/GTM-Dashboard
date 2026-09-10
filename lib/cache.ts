import { unstable_cache, revalidateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Cache tags (spec §0.2). Pages render from cached fetchers; every write path
 * calls `revalidate()` with the tags it touched.
 */
export const tags = {
  people: 'people',
  person: (id: string) => `person:${id}`,
  events: 'events',
  event: (id: string) => `event:${id}`,
  imports: 'imports',
  review: 'review',
  slack: 'slack',
  coffeeChats: 'coffee-chats',
  overview: 'overview',
  appUsers: 'app-users',
} as const;

/**
 * Run a read against a tagged cache entry.
 *
 * The Supabase client is built *outside* the cached callback on purpose:
 * `unstable_cache` forbids reading cookies inside it. Entries are therefore
 * shared across sessions, which is correct here because every reader of these
 * routes is an admin with identical access — members are 404'd by middleware and
 * blocked by RLS, and their one page (`/coffee-chats/log`) is uncached.
 */
export async function withCache<R>(
  keyParts: string[],
  cacheTags: string[],
  fn: (db: SupabaseClient) => Promise<R>,
): Promise<R> {
  const supabase = await createServerClient();
  return unstable_cache(() => fn(supabase), keyParts, { tags: cacheTags })();
}

export function revalidate(...cacheTags: string[]) {
  for (const t of cacheTags) revalidateTag(t);
}
