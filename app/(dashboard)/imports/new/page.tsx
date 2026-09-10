import { eventOptions, savedMappings } from '@/lib/queries';
import type { ImportKind } from '@/lib/types';
import { KIND_LABEL } from '@/lib/format';
import { Wizard } from './Wizard';

export default async function NewImportPage(
  { searchParams }: { searchParams: Promise<{ event?: string; kind?: string }> },
) {
  const { event, kind } = await searchParams;
  const [events, mappings] = await Promise.all([eventOptions(), savedMappings()]);
  const initialKind = kind && kind in KIND_LABEL ? (kind as ImportKind) : null;

  return (
    <Wizard
      events={events} mappings={mappings}
      initialKind={initialKind} initialEventId={event ?? null}
    />
  );
}
