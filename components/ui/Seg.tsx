'use client';

/** Segmented filter chips (`.seg` / `.seg-opt`). Options carry their own counts. */
export function Seg<T extends string>(
  { name, value, onChange, options }:
  { name: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] },
) {
  return (
    <div className="seg" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className="seg-opt">
          <input
            type="radio" name={name} value={o.value}
            checked={value === o.value} onChange={() => onChange(o.value)}
          />
          {o.label}
          {o.count !== undefined && <span className="text-neutral-500">{o.count}</span>}
        </label>
      ))}
    </div>
  );
}
