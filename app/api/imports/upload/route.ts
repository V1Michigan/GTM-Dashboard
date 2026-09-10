import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { fileHash, parseCsv } from '@/lib/imports/parse';
import { revalidate, tags } from '@/lib/cache';
import type { ImportKind, ImportSource } from '@/lib/types';

/** Bucket for the raw uploads (private). `storage_path` keeps the bucket prefix so it reads as spec §6 writes it. */
const BUCKET = 'imports';
const key = (storagePath: string) => storagePath.replace(`${BUCKET}/`, '');

const SOURCE: Record<ImportKind, ImportSource> = {
  event_registration: 'luma_csv',
  event_checkin: 'tally_csv',
  interest_form: 'tally_csv',
  community_interest_form: 'tally_csv',
  product_studio_application: 'tally_csv',
  coffee_chat: 'manual_csv',
  members_list: 'manual_csv',
  people_bulk: 'manual_csv',
};

const Body = z.object({
  kind: z.enum(Object.keys(SOURCE) as [ImportKind, ...ImportKind[]]),
  event_id: z.uuid().nullish(),
  semester: z.enum(['winter', 'fall']).nullish(),
  year: z.coerce.number().int().min(2000).max(2100).nullish(),
  // FormData carries strings, and z.coerce.boolean() would read "false" as true.
  replace_roster: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export interface UploadResult {
  import_id: string;
  file_name: string;
  size: number;
  row_count: number;
  column_count: number;
  file_hash: string;
  storage_path: string;
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  const db = await createServerClient();

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  const parsedBody = Body.safeParse(Object.fromEntries([...form.entries()].filter(([k]) => k !== 'file')));
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid import options.' }, { status: 400 });
  }
  const { kind, event_id, semester, year, replace_roster } = parsedBody.data;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = fileHash(bytes);

  // Identical file for the same (kind, event) is a re-upload of something already here.
  const dupe = db.from('imports').select('id').eq('file_hash', hash).eq('kind', kind);
  const { data: prior } = await (event_id ? dupe.eq('event_id', event_id) : dupe.is('event_id', null))
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (prior) {
    return NextResponse.json(
      { error: 'This exact file was already uploaded for this kind and event.', import_id: prior.id },
      { status: 409 },
    );
  }

  // The client parse is only ever a preview; the row/column counts stored come from this one.
  const { headers, rows } = parseCsv(new TextDecoder().decode(bytes));

  // Spec §4.9: Luma exports carry the event id inside qr_code_url. A different id
  // than the event already holds means the wrong event was picked — hard fail.
  if (kind === 'event_registration' && event_id) {
    const fileEventId = rows
      .map((r) => String(r.qr_code_url ?? ''))
      .find((u) => /evt-[A-Za-z0-9]+/.test(u))
      ?.match(/evt-[A-Za-z0-9]+/)?.[0];
    const { data: event } = await db.from('events').select('luma_event_id').eq('id', event_id).maybeSingle();
    if (fileEventId && event?.luma_event_id && event.luma_event_id !== fileEventId) {
      return NextResponse.json(
        {
          error: `This file is for Luma event ${fileEventId}, but the selected event is ${event.luma_event_id}. `
            + 'Wrong event selected — nothing was imported.',
        },
        { status: 400 },
      );
    }
  }

  const id = crypto.randomUUID();
  const storage_path = `${BUCKET}/${new Date().getFullYear()}/${id}.csv`;

  const up = await db.storage.from(BUCKET).upload(key(storage_path), bytes, {
    contentType: 'text/csv', upsert: false,
  });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  const { error } = await db.from('imports').insert({
    id, source: SOURCE[kind], kind, event_id: event_id ?? null,
    file_name: file.name, file_hash: hash, storage_path,
    status: 'uploaded', row_count: rows.length,
    semester: semester ?? null, year: year ?? null, replace_roster,
    uploaded_by: session.userId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidate(tags.imports);
  const result: UploadResult = {
    import_id: id, file_name: file.name, size: file.size,
    row_count: rows.length, column_count: headers.length, file_hash: hash, storage_path,
  };
  return NextResponse.json(result);
}
