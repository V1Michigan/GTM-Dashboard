import { describe, expect, it } from 'vitest';
import {
  isTestRow,
  normalizeEmail,
  normalizeName,
  splitName,
  typoDomainDistance,
  uniqnameFromEmail,
} from '@/lib/matching/normalize';

describe('normalizeEmail', () => {
  it('strips dots and +tags from umich addresses', () => {
    expect(normalizeEmail('  A.Va.Chen+v1@UMICH.edu ')).toBe('avachen@umich.edu');
    expect(normalizeEmail('i.kim@umich.edu')).toBe(normalizeEmail('ikim@umich.edu'));
  });

  it('keeps dots and tags everywhere else', () => {
    expect(normalizeEmail(' Ava.Chen+v1@Gmail.COM ')).toBe('ava.chen+v1@gmail.com');
  });

  it('leaves a malformed address as lowercased text', () => {
    expect(normalizeEmail(' NotAnEmail ')).toBe('notanemail');
  });
});

describe('uniqnameFromEmail', () => {
  it('is the local part of a umich address, after normalization', () => {
    expect(uniqnameFromEmail('A.Va.Chen+v1@umich.edu')).toBe('avachen');
  });

  it('is null off umich', () => {
    expect(uniqnameFromEmail('zoevas@gmail.com')).toBeNull();
    expect(uniqnameFromEmail('nkowal@umich.efu')).toBeNull();
  });
});

describe('normalizeName', () => {
  it('lowercases, strips punctuation, collapses whitespace and drops suffixes', () => {
    expect(normalizeName("  Ryan   O'Connell, Jr. ")).toBe('ryan o connell');
    expect(normalizeName('Theo Bergstrom III')).toBe('theo bergstrom');
  });
});

describe('splitName', () => {
  it('splits on the last space', () => {
    expect(splitName('Priya  Raghavan')).toEqual({ first: 'Priya', last: 'Raghavan' });
    expect(splitName('Harish Anand What')).toEqual({ first: 'Harish Anand', last: 'What' });
  });

  it('handles one token and empty input', () => {
    expect(splitName('Cher')).toEqual({ first: 'Cher', last: null });
    expect(splitName('   ')).toEqual({ first: null, last: null });
  });
});

describe('isTestRow', () => {
  it('catches the test rows the real exports contain', () => {
    expect(isTestRow({ email: 'test@test.edu' })).toBe(true);
    expect(isTestRow({ email: 'owen@test.com' })).toBe(true);
    expect(isTestRow({ email: 'someone@example.com', name: 'Test' })).toBe(true);
    expect(isTestRow({ email: 'TEST@umich.edu' })).toBe(true);
  });

  it('leaves real people alone', () => {
    expect(isTestRow({ email: 'avachen@umich.edu', name: 'Ava Chen' })).toBe(false);
    expect(isTestRow({ email: 'tester@umich.edu', name: 'Tessa Tester' })).toBe(false);
  });
});

describe('typoDomainDistance', () => {
  it('measures the distance from umich.edu', () => {
    expect(typoDomainDistance('avachen@umich.edu')).toBe(0);
    expect(typoDomainDistance('nkowal@umich.efu')).toBe(1);
    expect(typoDomainDistance('nkowal@umich.ed')).toBe(1);
    expect(typoDomainDistance('nkowal@umich.com')).toBe(3);
  });

  it('is null for unrelated domains', () => {
    expect(typoDomainDistance('zoevas@gmail.com')).toBeNull();
    expect(typoDomainDistance('not-an-email')).toBeNull();
  });
});
