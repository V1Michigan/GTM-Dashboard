import type { Gender, ImportKind, ImportSource, Json } from '@/lib/types';

/**
 * The §4.9 header -> canonical field defaults for every import kind, transcribed
 * from the real F26 exports. These ship as the saved mapping for each
 * (source, kind) and as the shape of `fixtures/csv/`.
 */

export { STANDING_MAP } from '@/lib/grade';

/** §4.9. Anything else is null; the raw value survives in `answers`. */
export const GENDER_MAP: Record<string, Gender> = {
  male: 'male',
  female: 'female',
  'non-binary': 'non_binary',
  'rather not say': 'prefer_not_to_say',
};

export type CanonicalField =
  | 'email'
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'uniqname'
  | 'standing'
  | 'gender'
  | 'major'
  | 'member_since'
  | 'notes'
  | 'luma_guest_id'
  | 'qr_code_url'
  | 'registered_at'
  | 'approval_status'
  | 'checked_in_at'
  | 'referral_source'
  | 'utm_source'
  | 'referred_by_email'
  | 'submitted_at'
  | 'submission_id'
  | 'programs'
  | 'member_email'
  | 'chatted_on';

export interface ColumnSpec {
  field: CanonicalField;
  /** CSV headers that feed this field, in export column order. First non-null wins (§4.8). */
  headers: string[];
  required?: boolean;
  transform?: (raw: string) => Json;
}

/**
 * Tally timestamps have no timezone (§4.9). They are wall-clock America/Detroit,
 * so the offset — EST or EDT — depends on the date; resolve it here, at parse
 * time, rather than storing an ambiguous string the database has to guess about.
 */
const DETROIT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Detroit',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function detroitWallClockAsUtc(instant: number): number {
  const parts: Record<string, string> = {};
  for (const part of DETROIT.formatToParts(instant)) parts[part.type] = part.value;
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}

export function detroitToUtcIso(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw.trim());
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  // Newton step on the offset: one correction lands it, the second confirms across a DST edge.
  let instant = wall;
  for (let i = 0; i < 2; i++) instant += wall - detroitWallClockAsUtc(instant);
  return new Date(instant).toISOString();
}

const isoTimestamp = (raw: string): string | null => {
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

const dateOnly = (raw: string): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? raw.trim() : (isoTimestamp(raw)?.slice(0, 10) ?? null);

/** §4.9: Luma exports no event id column; it only appears inside the check-in QR URL. */
const lumaEventId = (raw: string): string | null => /evt-[A-Za-z0-9]+/.exec(raw)?.[0] ?? null;

export const PROGRAM_QUESTION = 'What types of programs are you interested in?';

/**
 * §4.9: the multi-select is joined with ', ' but options contain commas inside
 * parentheses, so a naive split is wrong. Match the known options instead.
 */
export const PROGRAM_OPTIONS = [
  'Product Studio (a semester-long build program)',
  'Speaker events (founders, investors, operators)',
  'Hackathons and build nights',
  'Coffee chats with V1 members',
  'Startup internships and job postings',
  'Social events (mixers, trips, game nights)',
] as const;

export function splitPrograms(raw: string): string[] {
  const picked = PROGRAM_OPTIONS.filter((option) => raw.includes(option));
  const leftover = picked
    .reduce((rest, option) => rest.replace(option, ''), raw)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return [...picked, ...leftover];
}

/** §4.9: Tally explodes one checkbox question into a label column plus one column per option. */
export const MORE_QUESTIONS_PREFIX = 'Want to answer a few more questions';

const tallyMeta: ColumnSpec[] = [
  { field: 'submission_id', headers: ['Submission ID'] },
  { field: 'submitted_at', headers: ['Submitted at'], transform: detroitToUtcIso },
];

export const DEFAULT_MAPPINGS: Record<
  ImportKind,
  { source: ImportSource; columns: ColumnSpec[] }
> = {
  event_registration: {
    source: 'luma_csv',
    columns: [
      { field: 'luma_guest_id', headers: ['guest_id'] },
      { field: 'approval_status', headers: ['approval_status'] },
      { field: 'name', headers: ['name'] },
      { field: 'first_name', headers: ['first_name'] },
      { field: 'last_name', headers: ['last_name'] },
      { field: 'email', headers: ['email'], required: true },
      { field: 'registered_at', headers: ['created_at'], transform: isoTimestamp },
      { field: 'checked_in_at', headers: ['checked_in_at'], transform: isoTimestamp },
      { field: 'referral_source', headers: ['referrer'] },
      { field: 'utm_source', headers: ['utm_source'] },
      { field: 'referred_by_email', headers: ['referred_by'] },
      { field: 'qr_code_url', headers: ['qr_code_url'], transform: lumaEventId },
    ],
  },
  event_checkin: {
    source: 'tally_csv',
    columns: [
      ...tallyMeta,
      { field: 'name', headers: ['Name'] },
      { field: 'email', headers: ['Email'], required: true },
      { field: 'standing', headers: ['Year'] },
      { field: 'gender', headers: ['Gender'] },
      { field: 'referral_source', headers: ['How did you hear about V1 / Open House?'] },
    ],
  },
  interest_form: {
    source: 'tally_csv',
    columns: [
      ...tallyMeta,
      { field: 'first_name', headers: ['First Name'] },
      { field: 'last_name', headers: ['Last Name'] },
      { field: 'email', headers: ['Email'], required: true },
      { field: 'gender', headers: ['Gender', 'Gender (2)'] },
      { field: 'standing', headers: ['Grade', 'Grade (2)'] },
      { field: 'major', headers: ['Major(s)'] },
    ],
  },
  community_interest_form: {
    source: 'tally_csv',
    columns: [
      ...tallyMeta,
      { field: 'name', headers: ['Name'] },
      { field: 'email', headers: ['Email'], required: true },
      { field: 'standing', headers: ['Grade'] },
      { field: 'gender', headers: ['Gender'] },
      { field: 'major', headers: ['Major(s)'] },
      { field: 'programs', headers: [PROGRAM_QUESTION], transform: splitPrograms },
    ],
  },
  product_studio_application: {
    source: 'tally_csv',
    columns: [
      ...tallyMeta,
      { field: 'name', headers: ['Full Name'] },
      { field: 'email', headers: ['Email'], required: true },
      { field: 'uniqname', headers: ['Uniqname'] },
      { field: 'standing', headers: ['Grade'] },
      { field: 'gender', headers: ['Gender'] },
      { field: 'major', headers: ['Major(s)'] },
    ],
  },
  members_list: {
    source: 'manual_csv',
    columns: [
      { field: 'email', headers: ['email', 'Email'], required: true },
      { field: 'name', headers: ['name', 'Name'] },
      { field: 'member_since', headers: ['member_since', 'Member Since'], transform: dateOnly },
    ],
  },
  coffee_chat: {
    source: 'manual_csv',
    columns: [
      { field: 'email', headers: ['email', 'Email'], required: true },
      { field: 'name', headers: ['name', 'Name'] },
      { field: 'member_email', headers: ['member_email', 'Member Email'], required: true },
      { field: 'chatted_on', headers: ['chatted_on', 'Date'], transform: dateOnly },
      { field: 'notes', headers: ['notes', 'Notes'] },
    ],
  },
  people_bulk: {
    source: 'manual_csv',
    columns: [
      { field: 'email', headers: ['email', 'Email'], required: true },
      { field: 'name', headers: ['name', 'Name'] },
      { field: 'first_name', headers: ['first_name', 'First Name'] },
      { field: 'last_name', headers: ['last_name', 'Last Name'] },
      { field: 'uniqname', headers: ['uniqname', 'Uniqname'] },
      { field: 'standing', headers: ['grade', 'Grade'] },
      { field: 'gender', headers: ['gender', 'Gender'] },
      { field: 'major', headers: ['major', 'Major(s)'] },
      { field: 'notes', headers: ['notes', 'Notes'] },
    ],
  },
};

const HEURISTICS: [RegExp, CanonicalField][] = [
  [/^(e-?mail|email address)$/, 'email'],
  [/^first ?name$/, 'first_name'],
  [/^last ?name$/, 'last_name'],
  [/^(full |preferred )?name$/, 'name'],
  [/^uniqname$/, 'uniqname'],
  [/^(grade|year|class|class standing)$/, 'standing'],
  [/^gender$/, 'gender'],
  [/^major(\(s\)|s)?$/, 'major'],
  [/^submitted at$/, 'submitted_at'],
  [/^submission id$/, 'submission_id'],
  [/^member[_ ]since$/, 'member_since'],
  [/^notes?$/, 'notes'],
];

/** Saved mapping wins, then the §4.9 defaults, then header-name heuristics. */
export function guessMapping(
  headers: string[],
  kind: ImportKind,
  saved?: Record<string, string>,
): Record<string, string> {
  const defaults = new Map<string, CanonicalField>();
  for (const column of DEFAULT_MAPPINGS[kind].columns) {
    for (const header of column.headers) defaults.set(header.toLowerCase(), column.field);
  }
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const exact = header.trim().toLowerCase();
    // Tally appends ' (2)' when a question is re-added; both columns feed one field (§4.8).
    const base = exact.replace(/\s*\(\d+\)$/, '');
    const loose = base.replace(/_/g, ' ');
    const field =
      saved?.[header] ??
      defaults.get(exact) ??
      defaults.get(base) ??
      HEURISTICS.find(([pattern]) => pattern.test(loose))?.[1];
    if (field) mapping[header] = field;
  }
  return mapping;
}
