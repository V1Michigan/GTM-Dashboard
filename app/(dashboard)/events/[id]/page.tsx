import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatCard, Section, Tag } from '@/components/ui/primitives';
import { getEvent } from '@/lib/queries';
import type { ImportRecord, ImportStatus } from '@/lib/types';
import { EventHeader } from './EventHeader';
import { AttendeeTable } from './AttendeeTable';
import { fmtDateTime } from '@/lib/format';

const fmtStamp = (v: string) =>
  fmtDateTime(v);
const title = (v: string) => v.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());

const STATUS_TONE: Record<ImportStatus, 'accent' | 'neutral' | 'outline'> = {
  committed: 'accent', needs_review: 'outline', failed: 'outline',
  uploaded: 'neutral', parsed: 'neutral',
};

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getEvent(id);
  if (!detail) notFound();

  const { event, stats, attendees, imports } = detail;
  const registered = stats?.registered_count ?? 0;
  const checkedIn = stats?.checked_in_count ?? 0;
  const walkIns = stats?.walk_in_count ?? 0;
  // Registered-and-checked-in is checkedIn minus walk-ins, so no-shows fall out of the view.
  const noShows = registered - (checkedIn - walkIns);

  return (
    <div className="flex flex-col gap-5">
      <div className="text-[12.5px] text-neutral-500">
        <Link href="/events" className="text-neutral-400 no-underline">Events</Link> / {event.name}
      </div>

      <EventHeader event={event} />

      <div className="grid grid-cols-5 gap-3">
        <StatCard label="Registered" value={registered} />
        <StatCard label="Checked in" value={checkedIn} />
        <StatCard label="Walk-ins" value={walkIns} />
        <StatCard label="No-shows" value={noShows} />
        <StatCard label="Member check-ins" value={stats?.member_checkin_count ?? 0} />
      </div>

      <div className="grid grid-cols-[1fr_340px] items-start gap-6">
        <AttendeeTable rows={attendees} />

        <Section title="Import history">
          {imports.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-700 p-[14px] text-[13px] text-neutral-500">
              No imports for this event yet.
            </div>
          ) : (
            <div className="flex flex-col gap-[10px] text-[12.5px]">
              {imports.map((r, i) => (
                <div
                  key={r.id}
                  className={i < imports.length - 1 ? 'flex flex-col gap-[3px] border-b border-divider pb-[10px]' : 'flex flex-col gap-[3px]'}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{title(r.kind)}</span>
                    <Tag tone={STATUS_TONE[r.status]}>{r.status.replaceAll('_', ' ')}</Tag>
                  </div>
                  <span className="text-neutral-500">{fmtStamp(r.created_at)} · {counts(r)}</span>
                  {r.file_name && (
                    <Link href={`/imports/${r.id}`} className="text-[12px]">{r.file_name}</Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function counts(r: ImportRecord) {
  return [
    r.row_count !== null && `${r.row_count} rows`,
    r.rows_new && `${r.rows_new} new`,
    r.rows_updated && `${r.rows_updated} updated`,
    r.rows_unchanged && `${r.rows_unchanged} unchanged`,
    r.rows_review && `${r.rows_review} review`,
  ].filter(Boolean).join(' · ');
}
