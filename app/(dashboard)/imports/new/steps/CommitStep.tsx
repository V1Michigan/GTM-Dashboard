'use client';
import type { UploadResult } from '@/app/api/imports/upload/route';
import type { DryRunResult } from '@/app/api/imports/dry-run/route';

export function CommitStep({
  context, upload, dry, eventId, incomingWins, setIncomingWins,
  allowBadRows, setAllowBadRows, committing, onBack, onCommit,
}: {
  context: string;
  upload: UploadResult;
  dry: DryRunResult;
  eventId: string | null;
  incomingWins: boolean;
  setIncomingWins: (v: boolean) => void;
  allowBadRows: boolean;
  setAllowBadRows: (v: boolean) => void;
  committing: boolean;
  onBack: () => void;
  onCommit: () => void;
}) {
  const c = dry.counts;
  const cacheTags = ['people', 'events', eventId && `event:${eventId}`, 'imports', 'review', 'overview']
    .filter(Boolean).join(' · ');

  return (
    <div className="flex max-w-[620px] flex-col gap-5">
      <div>
        <h2 className="mb-1 text-[17px]">Commit import</h2>
        <p className="m-0 text-[13px] text-neutral-400">
          Runs apply_import in one transaction. Rows are only ever added or updated; nothing is deleted.
        </p>
      </div>

      <div className="card elev-sm gap-2 px-[18px] py-[14px] text-[13px]">
        <div className="grid gap-x-3 gap-y-[6px]" style={{ gridTemplateColumns: '160px 1fr' }}>
          <span className="text-neutral-500">Kind</span><span>{context}</span>
          <span className="text-neutral-500">File</span><span className="break-all">{upload.file_name}</span>
          <span className="text-neutral-500">Will write</span>
          <span>
            {c.new} new people · {c.updated} updated rows · {c.review} review items ·{' '}
            {c.unchanged + (allowBadRows ? 0 : c.bad)} rows skipped
          </span>
          <span className="text-neutral-500">Cache tags</span>
          <span className="font-mono text-[12px]">{cacheTags}</span>
        </div>
      </div>

      <div className="flex flex-col gap-[10px]">
        <label className="flex items-start gap-[10px] text-[13px]">
          <input
            type="checkbox" className="mt-[3px]" checked={incomingWins}
            onChange={(e) => setIncomingWins(e.target.checked)}
          />
          <span>
            Incoming values win
            <span className="mt-[2px] block text-[12px] text-neutral-500">
              Overwrite existing non-null person fields instead of creating field_conflict review items.
              Off by default.
            </span>
          </span>
        </label>
        <label className={`flex items-start gap-[10px] text-[13px] ${c.bad === 0 ? 'text-neutral-500' : ''}`}>
          <input
            type="checkbox" className="mt-[3px]" checked={allowBadRows} disabled={c.bad === 0}
            onChange={(e) => setAllowBadRows(e.target.checked)}
          />
          <span>
            Import bad rows anyway
            <span className="mt-[2px] block text-[12px] text-neutral-500">
              {c.bad === 0 ? 'No bad rows in this file.' : `${c.bad} test rows would be treated as real people.`}
            </span>
          </span>
        </label>
      </div>

      <div className="flex justify-between gap-2">
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={committing}>Back</button>
        <button type="button" className="btn btn-primary" onClick={onCommit} disabled={committing}>
          {committing ? 'Committing…' : `Commit ${c.rows} rows`}
        </button>
      </div>
    </div>
  );
}
