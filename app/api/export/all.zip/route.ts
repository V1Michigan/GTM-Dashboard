import { Readable } from 'node:stream';
import archiver from 'archiver';
import { requireAdmin } from '@/lib/auth';
import { EXPORT_TABLES, buildPeopleWide, csvChunks, stamp, type ExportTable } from '@/lib/export';
import { createServerClient } from '@/lib/supabase/server';

/** `GET /api/export/all.zip`: every table plus `people_wide.csv` (spec §6, §7). */
export async function GET() {
  await requireAdmin();
  const db = await createServerClient();

  const archive = archiver('zip', { zlib: { level: 9 } });
  for (const table of Object.keys(EXPORT_TABLES) as ExportTable[]) {
    archive.append(Readable.from(csvChunks(db, table)), { name: `${table}.csv` });
  }
  archive.append(await buildPeopleWide(db), { name: 'people_wide.csv' });
  // Not awaited: finalize() only settles once the response body is consumed.
  void archive.finalize();

  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="v1-gtm-export-${stamp()}.zip"`,
    },
  });
}
