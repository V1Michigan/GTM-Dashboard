'use server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { revalidate, tags } from '@/lib/cache';
import { createServerClient } from '@/lib/supabase/server';

/** Only umich.edu accounts can sign in at all (spec §4.7), so reject the rest here too. */
const Email = z.email().refine((e) => e.toLowerCase().endsWith('@umich.edu'), {
  message: 'Use a umich.edu address.',
});

export async function addAdmin(input: unknown): Promise<string | null> {
  const session = await requireAdmin();
  const parsed = Email.safeParse(input);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Enter a umich.edu address.';
  const db = await createServerClient();
  const { error } = await db.from('app_users').upsert(
    { email: parsed.data.toLowerCase(), role: 'admin', added_by: session.userId },
    { onConflict: 'email' },
  );
  if (error) return error.message;
  revalidate(tags.appUsers);
  return null;
}

export async function setRole(input: unknown): Promise<string | null> {
  const session = await requireAdmin();
  const parsed = z.object({ email: z.email(), role: z.enum(['admin', 'member']) }).safeParse(input);
  if (!parsed.success) return 'Unknown user.';
  if (parsed.data.email.toLowerCase() === session.email.toLowerCase()) {
    return 'You cannot change your own role.';
  }
  const db = await createServerClient();
  const { error } = await db.from('app_users')
    .update({ role: parsed.data.role }).eq('email', parsed.data.email);
  if (error) return error.message;
  revalidate(tags.appUsers);
  return null;
}
