import { requireAdmin } from '@/lib/auth';
import { csvChunks, isExportTable, stamp, toStream } from '@/lib/export';
import { createServerClient } from '@/lib/supabase/server';

/**
 * `GET /api/export/<table>.csv` (spec §6, §7). Admin only, and read through the
 * RLS client — no service client here, an export is just an admin reading rows.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ table: string }> }) {
  await requireAdmin();
  const table = (await params).table.replace(/\.csv$/, '');
  if (!isExportTable(table)) return new Response('unknown table', { status: 404 });

  const db = await createServerClient();
  return new Response(toStream(csvChunks(db, table)), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${table}-${stamp()}.csv"`,
    },
  });
}
