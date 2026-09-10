'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { Check } from '@phosphor-icons/react/dist/ssr';
import { Tag } from '@/components/ui/primitives';
import { guessMapping } from '@/lib/imports/mappings';
import type { EventRow, ImportKind, SavedColumnMapping, Semester } from '@/lib/types';
import type { UploadResult } from '@/app/api/imports/upload/route';
import type { DryRunResult } from '@/app/api/imports/dry-run/route';
import { KIND_LABEL } from '../ImportsTable';
import { KindStep } from './steps/KindStep';
import { UploadStep } from './steps/UploadStep';
import { MapStep } from './steps/MapStep';
import { DryRunStep } from './steps/DryRunStep';
import { CommitStep } from './steps/CommitStep';

export type WizardEvent = Pick<EventRow, 'id' | 'name' | 'event_date'>;
export interface Preview { headers: string[]; rows: Record<string, string>[] }

const STEPS = ['Kind', 'Upload CSV', 'Map columns', 'Dry run', 'Commit'];
const EVENT_KINDS: ImportKind[] = ['event_registration', 'event_checkin'];

/**
 * The whole wizard is this one component: it holds kind, event/semester, the
 * uploaded file, the mapping, the dry-run result and the commit flags, and the
 * step files below are presentation only. No state library, no context.
 */
export function Wizard({ events, mappings, initialKind, initialEventId }: {
  events: WizardEvent[];
  mappings: SavedColumnMapping[];
  initialKind: ImportKind | null;
  initialEventId: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<ImportKind | null>(initialKind);
  const [eventId, setEventId] = useState<string | null>(initialEventId);
  const [semester, setSemester] = useState<Semester>('fall');
  const [year, setYear] = useState(new Date().getFullYear());
  const [replaceRoster, setReplaceRoster] = useState(false);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [saveMapping, setSaveMapping] = useState(true);
  const [dry, setDry] = useState<DryRunResult | null>(null);
  const [incomingWins, setIncomingWins] = useState(false);
  const [allowBadRows, setAllowBadRows] = useState(false);
  const [busy, setBusy] = useState<'upload' | 'dry' | 'commit' | null>(null);
  const [error, setError] = useState<{ message: string; importId?: string } | null>(null);

  const event = events.find((e) => e.id === eventId) ?? null;
  const context = kind
    ? [KIND_LABEL[kind], event?.name ?? (kind === 'product_studio_application'
      ? `${semester === 'fall' ? 'Fall' : 'Winter'} ${year}` : null)].filter(Boolean).join(' · ')
    : null;

  async function onFile(file: File) {
    if (!kind) return;
    setBusy('upload'); setError(null);
    const body = new FormData();
    body.set('file', file);
    body.set('kind', kind);
    if (eventId) body.set('event_id', eventId);
    if (kind === 'product_studio_application') { body.set('semester', semester); body.set('year', String(year)); }
    body.set('replace_roster', String(replaceRoster));

    const res = await fetch('/api/imports/upload', { method: 'POST', body });
    const json = await res.json();
    if (!res.ok) {
      setError({ message: json.error ?? 'Upload failed.', importId: json.import_id });
      setBusy(null);
      return;
    }
    setUpload(json as UploadResult);

    // Preview only — the server has already re-parsed the file it stored.
    const parsed = Papa.parse<Record<string, string>>(await file.text(), {
      header: true, skipEmptyLines: true,
    });
    const headers = parsed.meta.fields ?? [];
    setPreview({ headers, rows: parsed.data.slice(0, 20) });
    setMapping(guessMapping(headers, kind, mappings.find((m) => m.kind === kind)?.mapping));
    setBusy(null);
  }

  async function runDryRun() {
    if (!upload) return;
    setStep(4); setBusy('dry'); setDry(null); setError(null);
    const res = await fetch('/api/imports/dry-run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ import_id: upload.import_id, mapping, save_mapping: saveMapping }),
    });
    const json = await res.json();
    if (!res.ok) setError({ message: json.error ?? 'Dry run failed.' });
    else setDry(json as DryRunResult);
    setBusy(null);
  }

  async function commit() {
    if (!upload) return;
    setBusy('commit'); setError(null);
    const res = await fetch('/api/imports/commit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ import_id: upload.import_id, incoming_wins: incomingWins, allow_bad_rows: allowBadRows }),
    });
    const json = await res.json();
    if (!res.ok) { setError({ message: json.error ?? 'Commit failed.' }); setBusy(null); return; }
    router.push(`/imports/${upload.import_id}`);
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="text-[12.5px] text-neutral-500">
        <Link href="/imports" className="text-neutral-400 no-underline">Imports</Link> / New import
      </div>
      <div className="flex items-center gap-3">
        <h1 className="text-[24px]">New import</h1>
        {context && <Tag tone="neutral">{context}</Tag>}
      </div>

      <div className="grid gap-10" style={{ gridTemplateColumns: '200px 1fr' }}>
        <ol className="m-0 flex list-none flex-col gap-[14px] p-0 text-[13px]">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const done = n < step;
            const current = n === step;
            return (
              <li
                key={label}
                aria-current={current ? 'step' : undefined}
                className={`flex items-center gap-[10px] ${
                  current ? 'text-accent-300' : done ? 'text-neutral-300' : 'text-neutral-500'}`}
              >
                <span
                  className={`grid size-[22px] place-items-center rounded-full text-[11px] ${
                    done ? 'bg-accent-800 text-accent-200'
                      : current ? 'border border-accent' : 'border border-neutral-700'}`}
                >
                  {done ? <Check size={11} weight="bold" /> : n}
                </span>
                {label}
              </li>
            );
          })}
        </ol>

        <div className="flex min-w-0 flex-col gap-[18px]">
          {error && (
            <div className="notice">
              {error.message}
              {error.importId && (
                <>
                  {' '}
                  <Link href={`/imports/${error.importId}`} className="text-accent-300">Open that import</Link>.
                </>
              )}
            </div>
          )}

          {step === 1 && (
            <KindStep
              kind={kind} setKind={setKind} events={events} eventId={eventId} setEventId={setEventId}
              semester={semester} setSemester={setSemester} year={year} setYear={setYear}
              replaceRoster={replaceRoster} setReplaceRoster={setReplaceRoster}
              needsEvent={!!kind && EVENT_KINDS.includes(kind)}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <UploadStep
              upload={upload} preview={preview} busy={busy === 'upload'} onFile={onFile}
              onBack={() => setStep(1)} onNext={() => setStep(3)}
            />
          )}
          {step === 3 && preview && kind && (
            <MapStep
              kind={kind} preview={preview} mapping={mapping} setMapping={setMapping}
              saveMapping={saveMapping} setSaveMapping={setSaveMapping}
              onBack={() => setStep(2)} onNext={runDryRun}
            />
          )}
          {step === 4 && (
            <DryRunStep
              dry={dry} running={busy === 'dry'} allowBadRows={allowBadRows} setAllowBadRows={setAllowBadRows}
              onBack={() => setStep(3)} onRetry={runDryRun} onNext={() => setStep(5)}
            />
          )}
          {step === 5 && upload && dry && (
            <CommitStep
              context={context ?? ''} upload={upload} dry={dry} eventId={eventId}
              incomingWins={incomingWins} setIncomingWins={setIncomingWins}
              allowBadRows={allowBadRows} setAllowBadRows={setAllowBadRows}
              committing={busy === 'commit'} onBack={() => setStep(4)} onCommit={commit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
