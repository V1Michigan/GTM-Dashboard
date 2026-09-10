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

  /*
   * Chunked rather than one `apply_import` call: PostgREST arms a
   * statement_timeout when a call begins and a statement cannot extend its own
   * deadline, so a large import was cancelled and rolled back in full. Each
   * chunk is its own short transaction; rows are never deleted by an import and
   * failures are recorded per row, so this is resumable rather than all-or-nothing.
   */
  const CHUNK = 200;
  for (let guard = 0; ; guard++) {
    const { data: done, error } = await db.rpc('apply_import_chunk', {
      p_import_id: import_id, p_limit: CHUNK,
    });
    if (error) {
      await db.from('imports').update({ status: 'failed', error: error.message }).eq('id', import_id);
      revalidate(tags.imports);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!done) break;
    if (guard > 1000) {
      const message = 'Import did not finish: too many chunks.';
      await db.from('imports').update({ status: 'failed', error: message }).eq('id', import_id);
      revalidate(tags.imports);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  const { error } = await db.rpc('finalize_import', { p_import_id: import_id });
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
