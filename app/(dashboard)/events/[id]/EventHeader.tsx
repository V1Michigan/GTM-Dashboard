'use client';

import Link from 'next/link';
import { UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { InlineEdit } from '@/components/ui/InlineEdit';
import { Tag } from '@/components/ui/primitives';
import type { EventRow } from '@/lib/types';
import { updateField } from '../../people/actions';

export function EventHeader({ event }: { event: EventRow }) {
  const save = (field: string, value: string | null) => updateField('events', event.id, field, value);

  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[26px]">{event.name}</h1>
          {event.event_type && <Tag tone="neutral">{event.event_type}</Tag>}
        </div>

        <div className="flex flex-wrap gap-6 text-[13px]">
          <InlineEdit label="Name" name="name" value={event.name} save={save} />
          <InlineEdit label="Date" name="event_date" type="date" value={event.event_date} save={save} />
          <InlineEdit label="Start time" name="start_time" value={event.start_time?.slice(0, 5) ?? null} save={save} />
          <InlineEdit label="End time" name="end_time" value={event.end_time?.slice(0, 5) ?? null} save={save} />
          <InlineEdit label="Location" name="location" value={event.location} save={save} />
          <InlineEdit label="Type" name="event_type" value={event.event_type} save={save} />
          <ReadOnlyId label="Luma event" value={event.luma_event_id} />
          <ReadOnlyId label="Tally check-in form" value={event.tally_checkin_form_id} />
        </div>

        <InlineEdit label="Notes" name="notes" value={event.notes} save={save} />
      </div>

      <div className="flex shrink-0 gap-2">
        <Link href={`/imports/new?event=${event.id}&kind=event_registration`} className="btn btn-secondary">
          <UploadSimple size={16} /> Upload Luma registrations CSV
        </Link>
        <Link href={`/imports/new?event=${event.id}&kind=event_checkin`} className="btn btn-primary">
          <UploadSimple size={16} /> Upload Tally check-in CSV
        </Link>
      </div>
    </div>
  );
}

/** Written by the first import that links this event, never by hand. */
function ReadOnlyId({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="label-kicker">{label}</div>
      <div className="mt-1 font-mono text-[12px]">
        {value ?? <span className="text-neutral-600">not linked</span>}
      </div>
    </div>
  );
}
