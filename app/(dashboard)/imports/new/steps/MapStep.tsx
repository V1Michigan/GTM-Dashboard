'use client';
import { useMemo } from 'react';
import { DEFAULT_MAPPINGS } from '@/lib/imports/mappings';
import type { ImportKind } from '@/lib/types';
import type { Preview } from '../Wizard';

/** Display copy for the canonical fields in DEFAULT_MAPPINGS, plus the transform each implies. */
const LABEL: Record<string, string> = {
  email: 'person email',
  name: 'first_name + last_name (split on last space)',
  standing: 'grad_year + student_level (class standing)',
  gender: 'gender (value map)',
  approval_status: 'luma_approval_status + registered',
  qr_code_url: 'events.luma_event_id',
  referral_source: 'referral_source (only if empty)',
  submission_id: 'idempotency key (tally_submission_id)',
  programs: 'programs of interest (multi-select)',
  member_email: 'the V1 member who did the chat',
};
const HINT: Record<string, string> = {
  checked_in_at: 'no TZ → America/Detroit',
  submitted_at: 'no TZ → America/Detroit',
  registered_at: 'ISO 8601 with Z',
  standing: 'Junior → 2028 for AY 2026',
  member_since: 'YYYY-MM-DD',
  qr_code_url: 'evt- id; a different event hard-fails the import',
  programs: 'split on the known option list, stored as an array',
};

export function MapStep({
  kind, preview, mapping, setMapping, saveMapping, setSaveMapping, onBack, onNext,
}: {
  kind: ImportKind;
  preview: Preview;
  mapping: Record<string, string>;
  setMapping: (m: Record<string, string>) => void;
  saveMapping: boolean;
  setSaveMapping: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const answers = kind === 'event_checkin' ? 'checkin_answers' : 'answers';

  // Every canonical field this kind knows about, plus anything the guess already used.
  const fields = useMemo(() => [...new Set([
    ...DEFAULT_MAPPINGS[kind].columns.map((c) => c.field as string),
    ...Object.values(mapping),
  ])].filter(Boolean).sort(), [kind, mapping]);

  const sample = (header: string) =>
    preview.rows.find((r) => r[header] != null && r[header] !== '')?.[header] ?? '';

  const set = (header: string, field: string) => {
    const next = { ...mapping };
    if (field) next[header] = field; else delete next[header];
    setMapping(next);
  };

  const mapped = preview.headers.filter((h) => mapping[h]).length;

  return (
    <div className="flex max-w-[900px] flex-col gap-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="mb-1 text-[17px]">Map columns</h2>
          <p className="m-0 text-[13px] text-neutral-400">
            {mapped} of {preview.headers.length} columns mapped; unmapped columns are kept under their
            original label in {answers}.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[12.5px] text-neutral-300">
          <input type="checkbox" checked={saveMapping} onChange={(e) => setSaveMapping(e.target.checked)} />
          Save as default for this kind
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="table table-dense">
          <thead>
            <tr>
              <th style={{ width: '36%' }}>CSV column</th>
              <th style={{ width: '26%' }}>Sample</th>
              <th aria-label="maps to" />
              <th>Canonical field</th>
            </tr>
          </thead>
          <tbody>
            {preview.headers.map((header) => {
              const field = mapping[header] ?? '';
              return (
                <tr key={header}>
                  <td>{header}</td>
                  <td className="text-neutral-500">{sample(header)}</td>
                  <td className="text-neutral-600" aria-hidden>→</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <select
                        className="input min-h-[30px] w-[280px] px-2 py-1 text-[12.5px]"
                        value={field} onChange={(e) => set(header, e.target.value)}
                        aria-label={`Canonical field for ${header}`}
                      >
                        <option value="">{answers} (keep label)</option>
                        {fields.map((f) => <option key={f} value={f}>{LABEL[f] ?? f}</option>)}
                      </select>
                      {field === 'gender' && <span className="text-[11px] text-accent-300">sensitive</span>}
                      {HINT[field] && <span className="text-[11px] text-neutral-500">{HINT[field]}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="m-0 rounded-md bg-surface px-3 py-[10px] text-[12px] text-neutral-500">
        Several CSV columns may map to one field (e.g. <code>Grade</code> and <code>Grade (2)</code> on the
        interest form); the first non-empty value in column order wins.
      </p>

      <div className="flex justify-between gap-2">
        <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>
        <button type="button" className="btn btn-primary" onClick={onNext}>Run dry run</button>
      </div>
    </div>
  );
}
