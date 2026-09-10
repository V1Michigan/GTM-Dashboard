import type { StudentLevel } from '@/lib/types';

/**
 * Class standing -> years remaining + level (spec §4.9). Re-exported by
 * `lib/imports/mappings.ts` as one of the two shared value maps.
 */
export const STANDING_MAP: Record<string, { years: number | null; level: StudentLevel }> = {
  freshman: { years: 4, level: 'undergrad' },
  sophomore: { years: 3, level: 'undergrad' },
  junior: { years: 2, level: 'undergrad' },
  'transfer junior': { years: 2, level: 'undergrad' },
  senior: { years: 1, level: 'undergrad' },
  graduate: { years: null, level: 'graduate' },
};

const DETROIT_YM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Detroit',
  year: 'numeric',
  month: 'numeric',
});

/** Academic year of a date; May 1 or later counts toward the upcoming fall (§4.9). */
export function academicYearOf(date: Date): number {
  const parts = DETROIT_YM.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value);
  return month >= 5 ? year : year - 1;
}

export function standingToGradYear(
  value: string | null | undefined,
  submittedAt: Date,
): { gradYear: number | null; studentLevel: StudentLevel | null } {
  const key = value?.trim().toLowerCase();
  if (!key) return { gradYear: null, studentLevel: null };
  const hit = STANDING_MAP[key];
  if (!hit) return { gradYear: null, studentLevel: 'other' };
  return {
    gradYear: hit.years === null ? null : academicYearOf(submittedAt) + hit.years,
    studentLevel: hit.level,
  };
}

const LABELS: Record<number, string> = { 4: 'Freshman', 3: 'Sophomore', 2: 'Junior', 1: 'Senior' };

/** Display only. "Junior" is never stored — it rots in eight months (spec §0.4). */
export function gradeLabel(gradYear: number | null, on: Date = new Date()): string | null {
  if (gradYear === null) return null;
  const left = gradYear - academicYearOf(on);
  return left <= 0 ? 'Alum' : LABELS[left] ?? null;
}
