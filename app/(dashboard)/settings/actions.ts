'use server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { revalidate, tags } from '@/lib/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/** Only umich.edu accounts can sign in at all (spec §4.7), so reject the rest here too. */
const Email = z.email().refine((e) => e.toLowerCase().endsWith('@umich.edu'), {
  message: 'Use a umich.edu address.',
});

/**
 * Create a login for someone. Deviates from spec §5's "service client only in
 * webhooks" rule for one narrow reason: creating an auth user requires the Admin
 * API, which needs the service key. It is guarded by requireAdmin() and touches
 * nothing but auth.users.
 *
 * Order matters. The allowlist trigger on auth.users (migration 0012) rejects
 * any address that is not already on app_users or attached to a V1 member, so
 * the app_users row has to exist first.
 */
export async function provisionUser(
  input: unknown,
): Promise<{ error: string } | { password: string }> {
  const session = await requireAdmin();
  const parsed = z.object({ email: Email, role: z.enum(['admin', 'member']) }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the address.' };
  const email = parsed.data.email.toLowerCase();

  const db = await createServerClient();
  const { error: rowError } = await db.from('app_users').upsert(
    { email, role: parsed.data.role, added_by: session.userId },
    { onConflict: 'email' },
  );
  if (rowError) return { error: rowError.message };

  // Shown to the admin once, then never retrievable — Supabase stores only a hash.
  const password = `V1-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const { error } = await createServiceClient().auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) {
    revalidate(tags.appUsers);   // the app_users row was still created
    return { error: `${error.message} (the ${parsed.data.role} row was saved)` };
  }
  revalidate(tags.appUsers);
  return { password };
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
