'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';

/** Drop every cached read so pages refetch from Supabase — for edits made outside the app. */
export async function syncAll() {
  await requireAdmin();
  revalidatePath('/', 'layout');
}
