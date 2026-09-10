'use server';

import { requireAdmin } from '@/lib/auth';
import { revalidate, tags } from '@/lib/cache';
import { createServerClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/types';
import { normalizeEmail } from '@/lib/matching/normalize';

/**
 * Trust boundary. `table` and `field` arrive from a client component, so both
 * are checked against this allowlist before either reaches a query — a column
 * name is never interpolated unchecked. Membership and emails get their own
 * actions because they touch more than one column.
 */
const EDITABLE: Record<string, string[]> = {
  people: [
    'first_name', 'last_name', 'uniqname', 'grad_year', 'grad_term',
    'student_level', 'major', 'gender', 'notes',
  ],
  events: ['name', 'event_date', 'start_time', 'end_time', 'location', 'event_type', 'notes'],
};

const NUMERIC = new Set(['grad_year']);

function tagsFor(table: string, id: string) {
  return table === 'events'
    ? [tags.event(id), tags.events, tags.overview]
    : [tags.person(id), tags.people, tags.overview];
}

async function logChange(
  db: Awaited<ReturnType<typeof createServerClient>>,
  rows: { table_name: string; row_id: string; field: string; old_value: Json; new_value: Json }[],
  changedBy: string,
) {
  await db.from('field_changes').insert(
    rows.map((r) => ({ ...r, source: 'manual', changed_by: changedBy })),
  );
}

/**
 * The single field write behind every inline edit on /people and /events.
 * Shared rather than one action per field; `/events` imports it from here.
 */
export async function updateField(table: string, id: string, field: string, value: string | null) {
  const session = await requireAdmin();
  if (!EDITABLE[table]?.includes(field)) throw new Error(`${table}.${field} is not editable`);

  const db = await createServerClient();
  const before = await db.from(table).select(field).eq('id', id).maybeSingle();
  const old = ((before.data ?? null) as Record<string, Json> | null)?.[field] ?? null;
  const next = value === null || value === '' ? null : NUMERIC.has(field) ? Number(value) : value;

  const { error } = await db.from(table).update({ [field]: next }).eq('id', id);
  if (error) throw new Error(error.message);

  await logChange(db, [{ table_name: table, row_id: id, field, old_value: old, new_value: next }], session.email);
  revalidate(...tagsFor(table, id));
}

/** Toggle V1 membership. `member_since` moves with it, and both are logged. */
export async function setMember(id: string, isMember: boolean, memberSince: string | null) {
  const session = await requireAdmin();
  const db = await createServerClient();

  const before = await db.from('people').select('is_v1_member, member_since').eq('id', id).maybeSingle();
  const prev = (before.data ?? {}) as { is_v1_member?: boolean; member_since?: string | null };
  const since = isMember ? (memberSince || new Date().toISOString().slice(0, 10)) : null;

  const { error } = await db.from('people')
    .update({ is_v1_member: isMember, member_since: since }).eq('id', id);
  if (error) throw new Error(error.message);

  await logChange(db, [
    { table_name: 'people', row_id: id, field: 'is_v1_member', old_value: prev.is_v1_member ?? false, new_value: isMember },
    { table_name: 'people', row_id: id, field: 'member_since', old_value: prev.member_since ?? null, new_value: since },
  ], session.email);
  revalidate(tags.person(id), tags.people, tags.overview);
}

export async function addEmail(personId: string, fd: FormData) {
  await requireAdmin();
  const email = String(fd.get('email') ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address');

  const db = await createServerClient();
  const { error } = await db.from('person_emails').insert({
    person_id: personId, email, email_normalized: normalizeEmail(email),
    is_primary: false, source: 'manual',
  });
  if (error) throw new Error(error.message);
  revalidate(tags.person(personId), tags.people);
}

export async function setPrimaryEmail(personId: string, emailId: string) {
  await requireAdmin();
  const db = await createServerClient();
  // The partial unique index allows one primary per person, so clear first.
  await db.from('person_emails').update({ is_primary: false }).eq('person_id', personId);
  const { error } = await db.from('person_emails').update({ is_primary: true }).eq('id', emailId);
  if (error) throw new Error(error.message);
  revalidate(tags.person(personId), tags.people);
}

export async function removeEmail(personId: string, emailId: string) {
  await requireAdmin();
  const db = await createServerClient();
  const { error } = await db.from('person_emails').delete().eq('id', emailId);
  if (error) throw new Error(error.message);
  revalidate(tags.person(personId), tags.people);
}

/** `merge_people` reassigns every FK, unions emails and writes the audit row. */
export async function mergePerson(keepId: string, dropId: string): Promise<{ error?: string }> {
  await requireAdmin();
  const db = await createServerClient();
  const { error } = await db.rpc('merge_people', { keep_id: keepId, drop_id: dropId });
  if (error) return { error: error.message };
  revalidate(
    tags.person(keepId), tags.person(dropId), tags.people,
    tags.events, tags.coffeeChats, tags.slack, tags.overview,
  );
  return {};
}

/** Plain delete; the cascades are in the schema. */
export async function deletePerson(id: string): Promise<{ error?: string }> {
  await requireAdmin();
  const db = await createServerClient();
  const { error } = await db.from('people').delete().eq('id', id);
  if (error) return { error: error.message };
  revalidate(
    tags.person(id), tags.people, tags.events,
    tags.coffeeChats, tags.slack, tags.overview,
  );
  return {};
}
