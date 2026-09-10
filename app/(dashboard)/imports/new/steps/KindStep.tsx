'use client';
import { useRouter } from 'next/navigation';
import { Combobox } from '@/components/ui/Combobox';
import { Field } from '@/components/ui/primitives';
import type { ImportKind, Semester } from '@/lib/types';
import { KIND_LABEL } from '@/lib/format';
import type { WizardEvent } from '../Wizard';

const DESCRIPTION: Record<ImportKind, string> = {
  event_registration: 'Luma guest export',
  event_checkin: 'Tally check-in form export',
  interest_form: 'Tally V1 interest form',
  community_interest_form: 'Tally community form',
  product_studio_application: 'Product Studio applications',
  coffee_chat: 'Coffee chat log',
  members_list: 'Roster: email, name, member_since',
  people_bulk: 'Generic people CSV',
  slack_members: 'Slack workspace export: links or creates people by email',
};
const ORDER = Object.keys(DESCRIPTION) as ImportKind[];
const CREATE = '__create_event__';

const eventDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Detroit',
});

export function KindStep({
  kind, setKind, events, eventId, setEventId, semester, setSemester, year, setYear,
  replaceRoster, setReplaceRoster, needsEvent, onNext,
}: {
  kind: ImportKind | null;
  setKind: (k: ImportKind) => void;
  events: WizardEvent[];
  eventId: string | null;
  setEventId: (id: string) => void;
  semester: Semester;
  setSemester: (s: Semester) => void;
  year: number;
  setYear: (y: number) => void;
  replaceRoster: boolean;
  setReplaceRoster: (v: boolean) => void;
  needsEvent: boolean;
  onNext: () => void;
}) {
  const router = useRouter();

  return (
    <div className="flex max-w-[760px] flex-col gap-[22px]">
      <div>
        <h2 className="mb-1 text-[17px]">What are you importing?</h2>
        <p className="m-0 text-[13px] text-neutral-400">
          The kind sets the parser, the saved column mapping and the merge rules.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-[10px]">
        {ORDER.map((k) => {
          const on = kind === k;
          return (
            <button
              key={k} type="button" onClick={() => setKind(k)} aria-pressed={on}
              className={`card cursor-pointer gap-1 text-left ${
                on ? 'shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'elev-sm'}`}
            >
              <span className={`card-title text-[14px] ${on ? 'text-accent-300' : ''}`}>{KIND_LABEL[k]}</span>
              <span className="card-body text-[12px]">{DESCRIPTION[k]}</span>
            </button>
          );
        })}
      </div>

      {needsEvent && (
        <div className="max-w-[480px]">
          <Field label="Event *">
            <Combobox
              value={eventId}
              onChange={(v) => (v === CREATE ? router.push('/events/new') : setEventId(v))}
              placeholder="Search events…"
              options={[
                ...events.map((e) => ({
                  value: e.id, label: e.name, hint: eventDate.format(new Date(e.event_date)),
                })),
                { value: CREATE, label: '+ Create new event…' },
              ]}
            />
          </Field>
        </div>
      )}

      {kind === 'product_studio_application' && (
        <div className="flex max-w-[480px] gap-3">
          <Field label="Semester">
            <select className="input" value={semester} onChange={(e) => setSemester(e.target.value as Semester)}>
              <option value="winter">Winter</option>
              <option value="fall">Fall</option>
            </select>
          </Field>
          <Field label="Year">
            <input
              className="input" type="number" min={2000} max={2100} value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </Field>
        </div>
      )}

      {kind === 'members_list' && (
        <label className="flex max-w-[520px] items-start gap-[10px] text-[13px]">
          <input
            type="checkbox" className="mt-[3px]" checked={replaceRoster}
            onChange={(e) => setReplaceRoster(e.target.checked)}
          />
          <span>
            Replace roster: unmark members not in this file
            <span className="mt-1 block text-[12px] text-neutral-500">
              Off by default. A roster is the one import where absence is meaningful; unmarking is
              logged to field_changes and never deletes anyone.
            </span>
          </span>
        </label>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => router.push('/imports')}>Cancel</button>
        <button
          type="button" className="btn btn-primary" onClick={onNext}
          disabled={!kind || (needsEvent && !eventId)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
