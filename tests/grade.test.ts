import { describe, expect, it } from 'vitest';
import { academicYearOf, gradeLabel, standingToGradYear } from '@/lib/grade';

describe('academicYearOf', () => {
  it('rolls over on May 1, not January 1', () => {
    expect(academicYearOf(new Date('2027-01-15'))).toBe(2026);
    expect(academicYearOf(new Date('2027-04-30T12:00:00Z'))).toBe(2026);
    expect(academicYearOf(new Date('2027-05-01T12:00:00Z'))).toBe(2027);
    expect(academicYearOf(new Date('2027-06-01'))).toBe(2027);
  });
});

describe('standingToGradYear', () => {
  const fall2026 = new Date('2026-09-05T22:00:00Z');

  it('matches the fall-2026 table in §4.9', () => {
    expect(standingToGradYear('Freshman', fall2026)).toEqual({
      gradYear: 2030,
      studentLevel: 'undergrad',
    });
    expect(standingToGradYear('Sophomore', fall2026).gradYear).toBe(2029);
    expect(standingToGradYear('Junior', fall2026).gradYear).toBe(2028);
    expect(standingToGradYear('Transfer Junior', fall2026).gradYear).toBe(2028);
    expect(standingToGradYear('Senior', fall2026).gradYear).toBe(2027);
  });

  it('crosses the academic-year boundary on May 1', () => {
    expect(standingToGradYear('Freshman', new Date('2027-01-15')).gradYear).toBe(2030);
    expect(standingToGradYear('Freshman', new Date('2027-06-01')).gradYear).toBe(2031);
  });

  it('stores a level but no year for graduates and unknown values', () => {
    expect(standingToGradYear('Graduate', fall2026)).toEqual({
      gradYear: null,
      studentLevel: 'graduate',
    });
    expect(standingToGradYear('Other', fall2026)).toEqual({ gradYear: null, studentLevel: 'other' });
    expect(standingToGradYear('cat', fall2026).studentLevel).toBe('other');
    expect(standingToGradYear('', fall2026)).toEqual({ gradYear: null, studentLevel: null });
    expect(standingToGradYear(null, fall2026)).toEqual({ gradYear: null, studentLevel: null });
  });
});

describe('gradeLabel', () => {
  const fall2026 = new Date('2026-10-01T12:00:00Z');

  it('derives the label at display time', () => {
    expect(gradeLabel(2030, fall2026)).toBe('Freshman');
    expect(gradeLabel(2028, fall2026)).toBe('Junior');
    expect(gradeLabel(2027, fall2026)).toBe('Senior');
    expect(gradeLabel(2026, fall2026)).toBe('Alum');
    expect(gradeLabel(2033, fall2026)).toBeNull();
    expect(gradeLabel(null, fall2026)).toBeNull();
  });

  it('re-derives a year later without anything being stored', () => {
    expect(gradeLabel(2028, new Date('2027-10-01T12:00:00Z'))).toBe('Senior');
  });
});
