import type { ReactNode } from 'react';

/**
 * Nocturne tag semantics (design handoff):
 *   accent  = settled positive state (committed, applied, member, bot member)
 *   outline = needs human attention (needs review, walk-in, stub, typo domain)
 *   neutral = neutral fact or inert state (draft, skipped, archived, event type)
 */
export function Tag(
  { tone = 'neutral', children }: { tone?: 'accent' | 'neutral' | 'outline'; children: ReactNode },
) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

/** Booleans read as `Yes` / muted em dash, never as raw true/false. */
export function YesNo({ value }: { value: boolean | null | undefined }) {
  return value ? <>Yes</> : <span className="text-neutral-600">—</span>;
}

export function Empty({ value }: { value: ReactNode }) {
  return value === null || value === undefined || value === ''
    ? <span className="text-neutral-600">—</span>
    : <>{value}</>;
}

export function PageHeader(
  { title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode },
) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[24px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-neutral-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function StatCard(
  { label, value, note, accent, href }:
  { label: string; value: ReactNode; note?: ReactNode; accent?: boolean; href?: string },
) {
  const inner = (
    <>
      <span className="card-kicker">{label}</span>
      <span className="text-[30px] font-medium leading-[1.1] tracking-[-0.02em]">{value}</span>
      {note && <span className="card-meta">{note}</span>}
    </>
  );
  const className = `card elev-sm no-underline ${accent ? 'shadow-[inset_0_0_0_1px_var(--color-accent)]' : ''}`;
  return href
    ? <a href={href} className={className} style={{ color: 'var(--color-text)' }}>{inner}</a>
    : <div className={className}>{inner}</div>;
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card elev-sm gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px]">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Field(
  { label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode },
) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="mt-1 text-[11px] text-neutral-500">{hint}</div>}
    </div>
  );
}

/** Key/value grid used for person fields, review payloads and form answers. */
export function KeyValues(
  { items, columns = 2 }: { items: [string, ReactNode][]; columns?: number },
) {
  return (
    <dl className="grid gap-x-6 gap-y-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="label-kicker">{k}</dt>
          <dd className="m-0 mt-1 text-[13px]"><Empty value={v} /></dd>
        </div>
      ))}
    </dl>
  );
}
