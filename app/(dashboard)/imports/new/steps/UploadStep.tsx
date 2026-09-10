'use client';
import { useRef, useState } from 'react';
import { UploadSimple } from '@phosphor-icons/react/dist/ssr';
import type { UploadResult } from '@/app/api/imports/upload/route';
import type { Preview } from '../Wizard';

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function UploadStep({ upload, preview, busy, onFile, onBack, onNext }: {
  upload: UploadResult | null;
  preview: Preview | null;
  busy: boolean;
  onFile: (file: File) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="flex min-w-0 flex-col gap-[18px]">
      <input
        ref={input} type="file" accept=".csv,text/csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />

      {upload ? (
        <div className="flex items-center justify-between gap-4 rounded-md border border-accent-800 bg-surface px-[18px] py-[14px]">
          <div className="flex min-w-0 flex-col gap-[2px]">
            <span className="truncate text-[13.5px]">{upload.file_name}</span>
            <span className="text-[12px] text-neutral-500">
              {kb(upload.size)} · {upload.row_count} rows · {upload.column_count} columns · sha256{' '}
              {upload.file_hash.slice(0, 4)}…{upload.file_hash.slice(-4)} · uploaded to {upload.storage_path}
            </span>
          </div>
          <button type="button" className="btn btn-ghost text-[12px]" onClick={() => input.current?.click()}>
            Replace file
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setOver(false);
            const f = e.dataTransfer.files?.[0]; if (f) onFile(f);
          }}
          className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-[13px] ${
            over ? 'border-accent text-accent-300' : 'border-neutral-700 text-neutral-400'}`}
        >
          <UploadSimple size={20} aria-hidden />
          {busy ? 'Uploading and parsing on the server…' : 'Drop the CSV here, or click to choose a file'}
          <span className="text-[12px] text-neutral-500">
            The file is stored privately and re-parsed on the server before anything is written.
          </span>
        </button>
      )}

      {preview && (
        <>
          <span className="text-[13px] text-neutral-400">
            Preview · first {preview.rows.length} of {upload?.row_count ?? preview.rows.length} rows
            (parsed in the browser; the server re-parses before commit)
          </span>
          <div className="overflow-x-auto rounded-md border border-divider">
            <table className="table table-dense whitespace-nowrap text-[12px]">
              <thead>
                <tr>{preview.headers.map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    {preview.headers.map((h) => <td key={h}>{row[h]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex justify-between gap-2">
        <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>
        <button type="button" className="btn btn-primary" onClick={onNext} disabled={!upload || busy}>
          Continue to mapping
        </button>
      </div>
    </div>
  );
}
