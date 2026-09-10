/**
 * The overview's two charts. Plain CSS bars, no charting library: a neutral-800
 * track, a neutral-500 fill, the accent on the highlighted value only, and a
 * dashed outline with no fill for something that has not happened yet.
 */
export interface Bar {
  label: string;
  value: number;
  /** Total the fill sits inside — registrations, for a check-in bar. */
  track?: number;
  note?: string;
  highlight?: boolean;
  /** Upcoming: dashed outline, no fill. */
  pending?: boolean;
}

/** Floors a non-zero bar at 2% so a value of 1 is still visible. */
const pct = (n: number, d: number) => (d > 0 && n > 0 ? Math.max(2, Math.round((n / d) * 100)) : 0);

export function BarChart({ bars, layout }: { bars: Bar[]; layout: 'columns' | 'rows' }) {
  const max = Math.max(1, ...bars.map((b) => b.track ?? b.value));

  if (layout === 'rows') {
    return (
      <div className="flex flex-col gap-[9px] text-[12.5px]">
        {bars.map((b) => (
          <div key={b.label} className="grid grid-cols-[110px_1fr_44px] items-center gap-3">
            <span className="truncate">{b.label}</span>
            <div className="h-[14px] rounded-[3px] bg-neutral-800">
              <div
                className={`h-full rounded-[3px] ${b.highlight ? 'bg-accent-500' : 'bg-neutral-500'}`}
                style={{ width: `${pct(b.value, max)}%` }}
              />
            </div>
            <span className="text-right text-neutral-300">{b.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    );
  }

  const columns = { gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid h-[200px] items-end gap-[18px] px-[6px]" style={columns}>
        {bars.map((b) => (
          <div key={b.label} className="flex h-full flex-col justify-end">
            {b.pending ? (
              <div
                className="rounded-t-[3px] border border-b-0 border-dashed border-neutral-700"
                style={{ height: `${pct(b.track ?? b.value, max)}%` }}
              />
            ) : (
              <div
                className="relative rounded-t-[3px] bg-neutral-800"
                style={{ height: `${pct(b.track ?? b.value, max)}%` }}
              >
                <div
                  className={`absolute inset-x-0 bottom-0 rounded-t-[3px] ${
                    b.highlight ? 'bg-accent-500' : 'bg-neutral-500'
                  }`}
                  style={{ height: `${pct(b.value, b.track ?? b.value)}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="grid gap-[18px] px-[6px] text-center text-[11px] text-neutral-500" style={columns}>
        {bars.map((b) => (
          <span key={b.label} className="truncate">
            {b.label}
            <br />
            <span className="text-neutral-300">{b.note ?? b.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
