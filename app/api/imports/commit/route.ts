import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { revalidate, tags } from '@/lib/cache';

const Body = z.object({
  import_id: z.uuid(),
  incoming_wins: z.boolean().default(false),
  allow_bad_rows: z.boolean().default(false),
});

export async function POST(req: Request) {
  await requireAdmin();
  const db = await createServerClient();

  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const { import_id, incoming_wins, allow_bad_rows } = body.data;

  const { data: record } = await db.from('imports').select('*').eq('id', import_id).maybeSingle();
  if (!record) return NextResponse.json({ error: 'Import not found.' }, { status: 404 });

  // Both flags are read by apply_import off the import row (spec §4.8).
  await db.from('imports').update({ incoming_wins, allow_bad_rows }).eq('id', import_id);
  if (allow_bad_rows) {
    // The dry run parked test rows as failed; the override puts them back in play.
    await db.from('import_rows').update({ status: 'pending', error: null })
      .eq('import_id', import_id).like('error', 'bad_row:%');
  }

  const { error } = await db.rpc('apply_import', { p_import_id: import_id });
  if (error) {
    await db.from('imports').update({ status: 'failed', error: error.message }).eq('id', import_id);
    revalidate(tags.imports);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidate(
    tags.people, tags.events, tags.imports, tags.review, tags.overview,
    ...(record.event_id ? [tags.event(record.event_id)] : []),
  );
  const { data: after } = await db.from('imports').select('status').eq('id', import_id).maybeSingle();
  return NextResponse.json({ import_id, status: after?.status ?? 'committed' });
}
