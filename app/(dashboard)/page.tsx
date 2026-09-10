import Link from 'next/link';
import { CalendarPlus, SlackLogo, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { BarChart, type Bar } from './BarChart';
import { StatCard, Tag } from '@/components/ui/primitives';
import { overview } from '@/lib/queries';
import type { ImportStatus } from '@/lib/types';

/** Date-only strings are parsed at local midnight so they never shift a day. */
const day = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const stamp = (t: string) =>
  new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const sentence = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const STATUS_TONE: Record<ImportStatus, 'accent' | 'outline' | 'neutral'> = {
  committed: 'accent', needs_review: 'outline', failed: 'outline', uploaded: 'neutral', parsed: 'neutral',
};

export default async function OverviewPage() {
  const { stats, checkins, slackBars, imports, upcoming } = await overview();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const semester = `${now.getMonth() >= 7 ? 'Fall' : 'Winter'} ${now.getFullYear()}`;
  const empty = (stats?.total_people ?? 0) === 0 && (stats?.events_this_semester ?? 0) === 0;

  const registered = new Map(checkins.map((e) => [e.event_id, e.registered_count]));
  const current = checkins.filter((e) => e.event_date <= today).at(-1)?.event_id;
  const eventBars: Bar[] = checkins.slice(-6).map((e) => ({
    label: e.name,
    value: e.checked_in_count,
    track: Math.max(e.registered_count, e.checked_in_count),
    note: e.event_date > today ? `${e.registered_count} reg` : String(e.checked_in_count),
    highlight: e.event_id === current,
    pending: e.event_date > today,
  }));
  const channelBars: Bar[] = slackBars.map((c, i) => ({
    label: `#${c.name}`, value: c.messages_30d, highlight: i === 0,
  }));

  const zero = (n: number) => (empty ? <span className="text-neutral-600">{n}</span> : n.toLocaleString());

  return (
    <div className="flex flex-col gap-[26px]">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="label-kicker mb-1">{semester}</div>
          <h1 className="text-[24px]">Overview</h1>
        </div>
        <div className="text-[12px] text-neutral-500">Public Slack channels sync daily at 03:00</div>
      </header>

      <div className="grid grid-cols-5 gap-3">
        <StatCard label="Total people" value={zero(stats?.total_people ?? 0)} />
        <StatCard label="V1 members" value={zero(stats?.members ?? 0)} />
        <StatCard label="People in Slack" value={zero(stats?.in_slack ?? 0)} />
        <StatCard
          label="Events this semester"
          value={zero(stats?.events_this_semester ?? 0)}
          note={upcoming.length > 0 ? `${upcoming.length} upcoming` : undefined}
        />
        <StatCard
          label="Open review items"
          value={zero(stats?.open_review_items ?? 0)}
          note="Open queue →"
          accent
          href="/review"
        />
      </div>

      {empty ? (
        <div className="flex max-w-[640px] flex-col items-start gap-[14px] rounded-lg border border-dashed border-neutral-700 p-20">
          <h2 className="text-[20px]">Nothing here yet</h2>
          <p className="m-0 max-w-[52ch] text-[14px] text-neutral-400">
            Create your first event, then upload its Luma guest export and Tally check-in export.
            Charts appear once an import is committed.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link className="btn btn-primary" href="/events/new">
              <CalendarPlus size={16} aria-hidden />New event
            </Link>
            <Link className="btn btn-secondary" href="/imports/new">
              <UploadSimple size={16} aria-hidden />Upload a CSV
            </Link>
            <Link className="btn btn-ghost" href="/settings#integrations">
              <SlackLogo size={16} aria-hidden />Connect Slack
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <section className="card elev-sm gap-4 px-5 py-[18px]">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[14px]">Check-ins per event</h2>
                <span className="text-[11px] text-neutral-500">From event_stats · registered shown faint</span>
              </div>
              {eventBars.length > 0
                ? <BarChart bars={eventBars} layout="columns" />
                : <p className="m-0 text-[13px] text-neutral-500">No events yet.</p>}
            </section>

            <section className="card elev-sm gap-[14px] px-5 py-[18px]">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[14px]">Slack messages per channel</h2>
                <span className="text-[11px] text-neutral-500">Last 30 days · public channels only</span>
              </div>
              {channelBars.length > 0
                ? <BarChart bars={channelBars} layout="rows" />
                : <p className="m-0 text-[13px] text-neutral-500">No Slack activity yet.</p>}
            </section>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <section className="card elev-sm gap-[10px] px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[14px]">Recent imports</h2>
                <Link className="text-[12px] no-underline" href="/imports">All imports</Link>
              </div>
              <table className="table table-dense">
                <tbody>
                  {imports.map((i) => (
                    <tr key={i.id}>
                      <td className="text-neutral-400">{stamp(i.created_at)}</td>
                      <td>{sentence(i.kind)}{i.event ? ` · ${i.event.name}` : ''}</td>
                      <td><Tag tone={STATUS_TONE[i.status]}>{sentence(i.status)}</Tag></td>
                      <td className="num text-neutral-400">{i.row_count ?? 0} rows</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="card elev-sm gap-[10px] px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[14px]">Upcoming events</h2>
                <Link className="text-[12px] no-underline" href="/events">All events</Link>
              </div>
              <table className="table table-dense">
                <tbody>
                  {upcoming.map((e) => (
                    <tr key={e.id}>
                      <td>{day(e.event_date)}</td>
                      <td>{e.name}</td>
                      <td className="text-neutral-400">{e.event_type ?? ''}</td>
                      <td className="num text-neutral-400">{registered.get(e.id) ?? 0} registered</td>
                    </tr>
                  ))}
                  {upcoming.length === 0 && (
                    <tr><td className="text-neutral-500">Nothing scheduled.</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
