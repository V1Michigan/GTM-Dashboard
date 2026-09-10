'use client';
import type { DryRunResult, PreviewRow } from '@/app/api/imports/dry-run/route';

function Count({ label, value, note, accent }: { label: string; value: string; note?: string; accent?: boolean }) {
  return (
    <div className={`card elev-sm gap-[2px] px-[14px] py-3 ${
      accent ? 'shadow-[0_0_0_1px_var(--color-accent-700)]' : ''}`}
    >
      <span className="card-kicker">{label}</span>
      <span className="text-[22px] font-medium">{value}</span>
      {note && <span className="card-meta">{note}</span>}
    </div>
  );
}

function PreviewTable({ rows, showConfidence }: { rows: PreviewRow[]; showConfidence?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-dense">
        <tbody>
          {rows.map((r) => (
            <tr key={r.row}>
              <td className="text-neutral-500">{r.row}</td>
              <td>{r.incoming}</td>
              <td className="text-neutral-400">{r.reason}</td>
              {r.candidate !== null && <td>{r.candidate}</td>}
              {showConfidence && (
                <td className="num">
                  {r.confidence?.toFixed(2) ?? '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionHead({ title, note, action }: { title: string; note?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[14px] font-medium">{title}</span>
      {note && <span className="text-[12px] text-neutral-500">{note}</span>}
      {action}
    </div>
  );
}

export function DryRunStep({ dry, running, allowBadRows, setAllowBadRows, onBack, onRetry, onNext }: {
  dry: DryRunResult | null;
  running: boolean;
  allowBadRows: boolean;
  setAllowBadRows: (v: boolean) => void;
  onBack: () => void;
  onRetry: () => void;
  onNext: () => void;
}) {
  const c = dry?.counts;
  const n = (v: number | undefined) => (v === undefined ? '—' : String(v));

  return (
    <div className="flex max-w-[960px] flex-col gap-[18px]">
      <div>
        <h2 className="mb-1 text-[17px]">Dry run</h2>
        <p className="m-0 text-[13px] text-neutral-400">
          {running
            ? 'Parsing the stored file and matching every row. Nothing is being written.'
            : 'Nothing has been written. This is what committing would do.'}
        </p>
      </div>

      <div className="grid grid-cols-6 gap-[10px]">
        <Count label="Rows" value={n(c?.rows)} />
        <Count label="New people" value={n(c?.new)} note="created on commit" />
        <Count label="Updated" value={n(c?.updated)} />
        <Count label="Unchanged" value={n(c?.unchanged)} />
        <Count label="Review" value={n(c?.review)} accent />
        <Count label="Bad rows" value={n(c?.bad)} note="test rows, skipped" />
      </div>

      {dry && dry.review.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHead
            title={`Rows needing review · ${dry.review.length}`}
            note="These will land in the review queue after commit"
          />
          <PreviewTable rows={dry.review} showConfidence />
        </div>
      )}

      {dry && dry.autoLinked.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHead
            title={`Auto-linked via uniqname · ${dry.autoLinked.length}`}
            note="Confidence ≥ 0.9; new email added to the person, no review needed"
          />
          <PreviewTable rows={dry.autoLinked} showConfidence />
        </div>
      )}

      {dry && dry.bad.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHead
            title={`Bad rows · ${dry.bad.length}`}
            action={(
              <label className="ml-auto flex items-center gap-2 text-[12.5px] text-neutral-400">
                <input type="checkbox" checked={allowBadRows} onChange={(e) => setAllowBadRows(e.target.checked)} />
                Import anyway
              </label>
            )}
          />
          <PreviewTable rows={dry.bad} />
        </div>
      )}

      <div className="flex justify-between gap-2">
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={running}>Back to mapping</button>
        <span className="flex gap-2">
          {dry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Re-run</button>}
          <button type="button" className="btn btn-primary" onClick={onNext} disabled={running || !dry}>
            {running ? 'Running dry run…' : 'Continue to commit'}
          </button>
        </span>
      </div>
    </div>
  );
}
