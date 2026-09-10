import { z } from 'zod';
import { standingToGradYear } from '@/lib/grade';
import { isTestRow, normalizeEmail, splitName, uniqnameFromEmail } from '@/lib/matching/normalize';
import type { Gender, ImportKind, Json, StudentLevel } from '@/lib/types';
import {
  DEFAULT_MAPPINGS,
  GENDER_MAP,
  MORE_QUESTIONS_PREFIX,
  PROGRAM_QUESTION,
  type CanonicalField,
  type ColumnSpec,
} from './mappings';

/** The canonical row `apply_import` consumes. Every kind produces this one shape. */
export interface ParsedRow {
  email: string | null;
  email_normalized: string | null;
  first_name: string | null;
  last_name: string | null;
  uniqname: string | null;
  grad_year: number | null;
  student_level: StudentLevel | null;
  gender: Gender | null;
  major: string | null;
  member_since: string | null;
  notes: string | null;
  member_email: string | null;
  chatted_on: string | null;
  luma_guest_id: string | null;
  luma_event_id: string | null;
  registered: boolean | null;
  registered_at: string | null;
  luma_approval_status: string | null;
  checked_in: boolean | null;
  checked_in_at: string | null;
  referral_source: string | null;
  utm_source: string | null;
  referred_by_email: string | null;
  submitted_at: string | null;
  tally_submission_id: string | null;
  /** Unmapped headers under their original label; `event_checkin` writes these to `checkin_answers`. */
  answers: Record<string, Json>;
  is_test_row: boolean;
}

const mappedRow = z.object({
  fields: z.record(z.string(), z.string()),
  unmapped: z.record(z.string(), z.string()),
});

export type MappedRow = z.infer<typeof mappedRow>;

export function rowSchema(kind: ImportKind): z.ZodType<ParsedRow> {
  const spec = DEFAULT_MAPPINGS[kind];
  const transforms = new Map<CanonicalField, ColumnSpec['transform']>(
    spec.columns.map((column) => [column.field, column.transform]),
  );
  const required = spec.columns.filter((column) => column.required).map((column) => column.field);
  return mappedRow
    .superRefine((row, ctx) => {
      for (const field of required) {
        if (!row.fields[field]?.trim()) {
          ctx.addIssue({ code: 'custom', message: `missing ${field}`, path: ['fields', field] });
        }
      }
    })
    .transform((row) => toParsedRow(kind, row, transforms));
}

function toParsedRow(
  kind: ImportKind,
  row: MappedRow,
  transforms: Map<CanonicalField, ColumnSpec['transform']>,
): ParsedRow {
  const raw = (field: CanonicalField): string | null => row.fields[field]?.trim() || null;
  const value = (field: CanonicalField): Json | null => {
    const source = raw(field);
    if (source === null) return null;
    const transform = transforms.get(field);
    return transform ? transform(source) : source;
  };
  const text = (field: CanonicalField): string | null => {
    const result = value(field);
    return typeof result === 'string' ? result : null;
  };

  const email = raw('email');
  const emailNormalized = email ? normalizeEmail(email) : null;

  // §4.9: Luma leaves `last_name` null on some rows and Tally ships only `Name`.
  const full = raw('name');
  const split = full ? splitName(full) : { first: null, last: null };
  const firstName = raw('first_name') ?? split.first;
  const lastName = raw('last_name') ?? split.last;

  const submittedAt = text('submitted_at');
  const registeredAt = text('registered_at');
  const { gradYear, studentLevel } = standingToGradYear(
    raw('standing'),
    new Date(submittedAt ?? registeredAt ?? Date.now()),
  );

  const isCheckin = kind === 'event_checkin';
  const checkedInAt = isCheckin ? submittedAt : text('checked_in_at');
  const approval = raw('approval_status');
  const submissionId = raw('submission_id');
  const memberEmail = raw('member_email');

  const genderRaw = raw('gender');
  const gender = GENDER_MAP[genderRaw?.toLowerCase() ?? ''] ?? null;

  const answers: Record<string, Json> = { ...row.unmapped };
  // §4.1/§4.9: an unmapped gender ('cat' in the real export) stores null but keeps the raw value.
  if (genderRaw !== null && gender === null) answers.gender_raw = genderRaw;
  if (kind === 'community_interest_form') {
    collapseMoreQuestions(answers);
    const programs = value('programs');
    if (programs) answers[PROGRAM_QUESTION] = programs;
  }
  if (isCheckin && submissionId) answers._submission_id = submissionId;

  return {
    email,
    email_normalized: emailNormalized,
    first_name: firstName,
    last_name: lastName,
    uniqname:
      raw('uniqname')?.toLowerCase() ??
      (emailNormalized ? uniqnameFromEmail(emailNormalized) : null),
    grad_year: gradYear,
    student_level: studentLevel,
    gender,
    major: raw('major'),
    member_since: text('member_since'),
    notes: raw('notes'),
    member_email: memberEmail ? normalizeEmail(memberEmail) : null,
    chatted_on: text('chatted_on'),
    luma_guest_id: raw('luma_guest_id'),
    luma_event_id: text('qr_code_url'),
    registered: kind === 'event_registration' ? approval !== 'declined' : null,
    registered_at: registeredAt,
    luma_approval_status: approval,
    // §4.8: a registration import never asserts a check-in; Luma's column is empty in practice.
    checked_in: isCheckin || checkedInAt !== null ? true : null,
    checked_in_at: checkedInAt,
    referral_source: raw('referral_source'),
    utm_source: raw('utm_source'),
    referred_by_email: raw('referred_by_email'),
    submitted_at: submittedAt,
    tally_submission_id: submissionId,
    answers,
    is_test_row: isTestRow({ email, name: full ?? `${firstName ?? ''} ${lastName ?? ''}` }),
  };
}

const TRUTHY = /^(true|yes|1|x|checked)$/i;

/** §4.9: one checkbox question exploded into a label column plus one column per option. */
function collapseMoreQuestions(answers: Record<string, Json>): void {
  const keys = Object.keys(answers).filter((key) => key.startsWith(MORE_QUESTIONS_PREFIX));
  if (keys.length === 0) return;
  const picked: string[] = [];
  let label: string | null = null;
  for (const key of keys) {
    const cell = answers[key];
    delete answers[key];
    if (typeof cell !== 'string' || cell.trim() === '') continue;
    const option = /\(([^)]*)\)\s*$/.exec(key.slice(MORE_QUESTIONS_PREFIX.length))?.[1];
    if (option === undefined) label = cell;
    else if (TRUTHY.test(cell.trim())) picked.push(option);
  }
  const merged = picked.length > 0 ? picked : label;
  if (merged !== null) answers[keys[0]!] = merged;
}
