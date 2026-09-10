import Link from 'next/link';
import { Field } from '@/components/ui/primitives';
import { createEvent } from '../actions';

/** Free text per spec §4.3; the four known tags are offered, not enforced. */
const KNOWN_TYPES = ['speaker', 'social', 'workshop', 'demo_day'];

export default function NewEventPage() {
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="text-[12.5px] text-neutral-500">
        <Link href="/events" className="text-neutral-400 no-underline">Events</Link> / New event
      </div>
      <h1 className="m-0 text-[24px]">New event</h1>

      <form action={createEvent} className="flex max-w-[620px] flex-col gap-4">
        <Field label="Name *">
          <input className="input" name="name" required autoFocus />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Date *"><input className="input" name="event_date" type="date" required /></Field>
          <Field label="Start time"><input className="input" name="start_time" type="time" /></Field>
          <Field label="End time"><input className="input" name="end_time" type="time" /></Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Location"><input className="input" name="location" /></Field>
          <Field label="Type">
            <input className="input" name="event_type" list="event-types" placeholder="speaker" />
            <datalist id="event-types">
              {KNOWN_TYPES.map((t) => <option key={t} value={t} />)}
            </datalist>
            <div className="mt-[6px] flex gap-[6px]">
              {KNOWN_TYPES.map((t) => (
                <span
                  key={t} className="tag tag-outline"
                  style={{ borderColor: 'var(--color-neutral-700)', color: 'var(--color-neutral-400)' }}
                >
                  {t}
                </span>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Notes"><textarea className="input" name="notes" /></Field>

        <p className="m-0 text-[12px] text-neutral-500">
          Luma event ID and Tally check-in form ID are filled automatically on the first import
          for this event.
        </p>

        <div className="flex justify-end gap-2">
          <Link href="/events" className="btn btn-ghost">Cancel</Link>
          <button type="submit" className="btn btn-primary">Create event</button>
        </div>
      </form>
    </div>
  );
}
