import Link from 'next/link';
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/ui/primitives';
import { listEvents } from '@/lib/queries';
import { EventsTable } from './EventsTable';

export default async function EventsPage() {
  const events = await listEvents();
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.event_date >= today).length;

  return (
    <>
      <PageHeader
        title="Events"
        subtitle={`${events.length} events · ${upcoming} upcoming`}
        actions={
          <Link href="/events/new" className="btn btn-primary">
            <Plus size={16} /> New event
          </Link>
        }
      />
      <EventsTable rows={events} />
    </>
  );
}
