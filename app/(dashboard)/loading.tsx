/**
 * Every dashboard route renders live database state, so a navigation waits on
 * the slowest query in the route before the browser is sent anything. This is
 * the segment's fallback: once layout authentication finishes, the sidebar and
 * this skeleton can paint while the real page and review badge stream in.
 *
 * Deliberately generic — it stands in for /people, /events, /review and the
 * rest, so it mimics the shape they share (a header, then a block) rather than
 * any one of them.
 */
const Bar = ({ w, h = 13 }: { w: string; h?: number }) => (
  <div className="rounded-sm bg-surface-muted" style={{ width: w, height: h }} />
);

export default function DashboardLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="flex flex-col gap-[10px]">
          <Bar w="180px" h={24} />
          <Bar w="260px" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Bar w="150px" h={32} />
          <Bar w="110px" h={32} />
        </div>
      </header>

      <div className="flex flex-col gap-[18px]">
        <div className="flex items-center gap-2">
          <Bar w="300px" h={32} />
          <Bar w="280px" h={32} />
        </div>
        <div className="flex flex-col gap-[14px]">
          {/* Roughly one screen of rows; fewer would flash as the real table lands. */}
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Bar w="22%" /><Bar w="26%" /><Bar w="10%" /><Bar w="18%" /><Bar w="8%" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
