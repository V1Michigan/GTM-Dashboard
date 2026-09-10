'use client';
import { useState, type ReactNode } from 'react';

/**
 * A field that renders as text with a dashed underline and becomes an
 * accent-bordered input on activation. Each save is a Server Action that writes
 * a `field_changes` row (design handoff → spec §6).
 */
export function InlineEdit({
  label, value, name, save, type = 'text', options, display,
}: {
  label: ReactNode;
  value: string | null;
  /** What the read state shows when it differs from the edited value (e.g. `2028 · Junior`). */
  display?: ReactNode;
  name: string;
  save: (field: string, value: string | null) => Promise<void>;
  type?: 'text' | 'number' | 'date';
  options?: { value: string; label: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [pending, setPending] = useState(false);

  if (!editing) {
    return (
      <div>
        <div className="label-kicker">{label}</div>
        <button
          type="button"
          onClick={() => { setDraft(value ?? ''); setEditing(true); }}
          className="editable mt-1 text-left text-[13px]"
        >
          {display ?? value ?? <span className="text-neutral-600">—</span>}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        await save(name, draft.trim() === '' ? null : draft.trim());
        setPending(false);
        setEditing(false);
      }}
    >
      <div className="label-kicker">{label}</div>
      {options ? (
        <select className="input mt-1 border-accent" value={draft} onChange={(e) => setDraft(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          autoFocus type={type} className="input mt-1 border-accent"
          value={draft} onChange={(e) => setDraft(e.target.value)}
        />
      )}
      <div className="mt-2 flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>Save</button>
        <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}
