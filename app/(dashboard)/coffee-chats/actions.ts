'use server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { revalidate, tags } from '@/lib/cache';
import { createServerClient } from '@/lib/supabase/server';

/** Inputs arrive from a client component, so they are a trust boundary (spec §2). */
const Log = z.object({
  personId: z.uuid().nullable(),
  newPerson: z.object({ name: z.string().trim().min(1).max(120), email: z.email() }).nullable(),
  memberId: z.uuid().nullable(),
  chattedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'pick a date'),
  notes: z.string().trim().max(2000).nullable(),
});

const TOUCHED = [tags.coffeeChats, tags.people, tags.review, tags.overview];

export async function logCoffeeChat(input: unknown): Promise<string | null> {
  const session = await requireSession();
  const parsed = Log.safeParse(input);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Check the form.';
  const { personId, newPerson, memberId, chattedOn, notes } = parsed.data;
  if (!personId && !newPerson) return 'Pick who you chatted with.';
  const db = await createServerClient();

  if (session.role !== 'admin') {
    // Members never write to `people`. The security-definer function creates the
    // person if the email is unknown, files a review item, and fixes member_id
    // to current_person_id() (spec §4.7).
    let email = newPerson?.email ?? null;
    let name = newPerson?.name ?? null;
    if (personId) {
      const { data } = await db.from('people_directory').select('*').eq('id', personId).maybeSingle();
      email = (data?.primary_email as string | null) ?? null;
      name = [data?.first_name, data?.last_name].filter(Boolean).join(' ') || null;
      if (!email) return 'That person has no email on file. Ask an admin to add one.';
    }
    const { error } = await db.rpc('member_log_coffee_chat', {
      person_email: email, person_name: name, chatted_on: chattedOn, notes,
    });
    if (error) return error.message;
    revalidate(...TOUCHED);
    return null;
  }

  const member = memberId ?? session.personId;
  if (!member) return 'Pick the member who did the chat.';

  let target = personId;
  if (!target && newPerson) {
    const [first, ...rest] = newPerson.name.split(/\s+/);
    const { data: created, error: personError } = await db
      .from('people')
      .insert({ first_name: first ?? newPerson.name, last_name: rest.join(' ') || null })
      .select('id').single();
    if (personError || !created) return personError?.message ?? 'Could not create that person.';
    const email = newPerson.email.toLowerCase();
    const { error: emailError } = await db.from('person_emails')
      .insert({ person_id: created.id, email, is_primary: true, source: 'manual' });
    if (emailError) return emailError.message;
    // Same promise the member flow makes: an admin confirms the new person.
    await db.from('review_items').insert({
      kind: 'no_match', payload: { email, name: newPerson.name, origin: 'coffee_chat' },
    });
    target = created.id as string;
  }

  const { error } = await db.from('coffee_chats').insert({
    person_id: target, member_id: member, chatted_on: chattedOn,
    notes, source: 'manual', logged_by: session.userId,
  });
  if (error) return error.message;
  revalidate(...TOUCHED);
  return null;
}

/** RLS allows a member to delete only their own rows, and only under 24h old. */
export async function deleteCoffeeChat(id: unknown): Promise<string | null> {
  await requireSession();
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return 'Unknown chat.';
  const db = await createServerClient();
  const { error } = await db.from('coffee_chats').delete().eq('id', parsed.data);
  if (error) return error.message;
  revalidate(...TOUCHED);
  return null;
}
