import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DownloadSimple } from '@phosphor-icons/react/dist/ssr';
import { revalidate, tags } from '@/lib/cache';
import { getImport } from '@/lib/queries';
import { createServerClient } from '@/lib/supabase/server';
import { KIND_LABEL, StatusTag, fmtDateTime } from '../ImportsTable';
import { RowsTable, type ImportRowWithPerson } from './RowsTable';

function Count({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`card elev-sm gap-[2px] px-[14px] py-3 ${accent ? 'shadow-[0_0_0_1px_var(--color-accent-700)]' : ''}`}>
      <span className="card-kicker">{label}</span>
      <span className="text-[22px] font-medium">{value}</span>
    </div>
  );
}

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getImport(id);
  if (!data) notFound();
  const { record, rows, openReviewCount } = data;

  const db = await createServerClient();
  const signed = record.storage_path
    ? (await db.storage.from('imports').createSignedUrl(record.storage_path.replace('imports/', ''), 300)).data
    : null;

  const isBad = (r: ImportRowWithPerson) => r.error?.startsWith('bad_row') ?? false;
  const skipped = rows.filter((r) => r.status === 'skipped_unchanged' || isBad(r)).length;
  const failed = rows.filter((r) => r.status === 'failed' && !isBad(r)).length;

  // Re-run is offered only for a failed import: apply_import is idempotent per row,
  // so re-running picks up exactly the rows that never applied.
  async function rerun() {
    'use server';
    const client = await createServerClient();
    await client.from('imports').update({ status: 'parsed', error: null }).eq('id', id);
    const { error } = await client.rpc('apply_import', { p_import_id: id });
    if (error) {
      await client.from('imports').update({ status: 'failed', error: error.message }).eq('id', id);
    }
    revalidate(tags.imports, tags.people, tags.events, tags.review, tags.overview);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="text-[12.5px] text-neutral-500">
        <Link href="/imports" className="text-neutral-400 no-underline">Imports</Link> / {fmtDateTime(record.created_at)}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-[24px]">
              {KIND_LABEL[record.kind]}
              {record.event ? ` · ${record.event.name}` : ''}
            </h1>
            <StatusTag status={record.status} />
          </div>
          <div className="text-[13px] text-neutral-400">
            {[
              record.file_name,
              record.source,
              record.committed_at && `committed ${fmtDateTime(record.committed_at)}`,
              record.file_hash && `sha256 ${record.file_hash.slice(0, 4)}…${record.file_hash.slice(-4)}`,
            ].filter(Boolean).join(' · ')}
          </div>
          {record.error && <p className="notice m-0 max-w-[720px]">{record.error}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {record.status === 'failed' && (
            <form action={rerun}>
              <button type="submit" className="btn btn-secondary">Re-run</button>
            </form>
          )}
          {signed?.signedUrl && (
            <a href={signed.signedUrl} className="btn btn-secondary no-underline" download={record.file_name ?? true}>
              <DownloadSimple size={16} aria-hidden /> Download original file
            </a>
          )}
          {openReviewCount > 0 && (
            <Link href="/review" className="btn btn-primary no-underline">Open {openReviewCount} review items</Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-6 gap-[10px]">
        <Count label="Rows" value={record.row_count ?? rows.length} />
        <Count label="New" value={record.rows_new ?? 0} />
        <Count label="Updated" value={record.rows_updated ?? 0} />
        <Count label="Unchanged" value={record.rows_unchanged ?? 0} />
        <Count label="Review" value={record.rows_review ?? 0} accent />
        <Count
          label="Failed / skipped"
          value={<>{failed} <span className="text-[14px] text-neutral-500">/ {skipped}</span></>}
        />
      </div>

      <RowsTable rows={rows} />
    </div>
  );
}
