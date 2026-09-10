'use server';

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { revalidate, tags } from '@/lib/cache';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Field edits on an event go through `updateField` in ../people/actions — one
 * shared, allowlisted write that also logs to `field_changes`. Creation is the
 * only event-specific mutation.
 */
export async function createEvent(fd: FormData) {
  await requireAdmin();
  const text = (key: string) => {
    const v = String(fd.get(key) ?? '').trim();
    return v === '' ? null : v;
  };
  const name = text('name');
  const event_date = text('event_date');
  if (!name || !event_date) throw new Error('Name and date are required');

  const db = await createServerClient();
  const { data, error } = await db.from('events').insert({
    name,
    event_date,
    start_time: text('start_time'),
    end_time: text('end_time'),
    location: text('location'),
    event_type: text('event_type'),
    notes: text('notes'),
  }).select('id').single();
  if (error) throw new Error(error.message);

  revalidate(tags.events, tags.overview);
  redirect(`/events/${(data as { id: string }).id}`);
}
