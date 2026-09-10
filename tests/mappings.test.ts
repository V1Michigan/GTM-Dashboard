import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPersonIndex, matchPerson } from '@/lib/matching/matchPerson';
import {
  DEFAULT_MAPPINGS,
  GENDER_MAP,
  detroitToUtcIso,
  guessMapping,
  splitPrograms,
} from '@/lib/imports/mappings';
import { applyMapping, fileHash, parseCsv, rowHash } from '@/lib/imports/parse';
import type { ParsedRow } from '@/lib/imports/schemas';
import type { ImportKind } from '@/lib/types';

function importFixture(name: string, kind: ImportKind): ParsedRow[] {
  const text = readFileSync(new URL(`../fixtures/csv/${name}.csv`, import.meta.url), 'utf8');
  const { headers, rows } = parseCsv(text);
  const mapping = guessMapping(headers, kind);
  return rows.map((row) => applyMapping(row, mapping, kind).parsed);
}

const luma = importFixture('luma-registrations', 'event_registration');
const checkin = importFixture('tally-checkin', 'event_checkin');
const interest = importFixture('tally-interest-form', 'interest_form');
const community = importFixture('tally-community-interest', 'community_interest_form');
const productStudio = importFixture('tally-product-studio', 'product_studio_application');
const members = importFixture('members-list', 'members_list');

describe('guessMapping', () => {
  it('applies the §4.9 defaults, including several columns feeding one field', () => {
    const mapping = guessMapping(['Grade', 'Grade (2)', 'Gender', 'Gender (2)'], 'interest_form');
    expect(mapping).toEqual({
      Grade: 'standing',
      'Grade (2)': 'standing',
      Gender: 'gender',
      'Gender (2)': 'gender',
    });
  });

  it('falls back to header heuristics, and a saved mapping beats both', () => {
    expect(guessMapping(['E-Mail', 'Full Name', 'Class Standing'], 'people_bulk')).toEqual({
      'E-Mail': 'email',
      'Full Name': 'name',
      'Class Standing': 'standing',
    });
    expect(guessMapping(['Grade'], 'interest_form', { Grade: 'major' })).toEqual({ Grade: 'major' });
  });

  it('leaves unrecognised headers unmapped so they land in answers', () => {
    expect(guessMapping(['Respondent ID'], 'interest_form')).toEqual({});
  });

  it('covers every import kind', () => {
    for (const [kind, spec] of Object.entries(DEFAULT_MAPPINGS)) {
      expect(spec.columns.some((column) => column.field === 'email'), kind).toBe(true);
    }
  });
});

describe('value maps and transforms (§4.9)', () => {
  it('maps the four gender values Tally emits and nothing else', () => {
    expect(GENDER_MAP.male).toBe('male');
    expect(GENDER_MAP['non-binary']).toBe('non_binary');
    expect(GENDER_MAP['rather not say']).toBe('prefer_not_to_say');
    expect(GENDER_MAP.cat).toBeUndefined();
  });

  it('reads Tally timestamps as America/Detroit wall clock, DST included', () => {
    expect(detroitToUtcIso('2026-09-05 18:02:11')).toBe('2026-09-05T22:02:11.000Z');
    expect(detroitToUtcIso('2026-01-15 09:00:00')).toBe('2026-01-15T14:00:00.000Z');
    expect(detroitToUtcIso('2026-03-08 03:00:00')).toBe('2026-03-08T07:00:00.000Z');
    expect(detroitToUtcIso('2026-11-01 03:00:00')).toBe('2026-11-01T08:00:00.000Z');
    expect(detroitToUtcIso('not a date')).toBeNull();
  });

  it('splits the multi-select on known options, not on commas', () => {
    expect(
      splitPrograms(
        'Product Studio (a semester-long build program), Speaker events (founders, investors, operators)',
      ),
    ).toEqual([
      'Product Studio (a semester-long build program)',
      'Speaker events (founders, investors, operators)',
    ]);
  });
});

describe('every fixture imports with zero failed rows', () => {
  const counts: [string, ParsedRow[], number][] = [
    ['luma-registrations', luma, 20],
    ['tally-checkin', checkin, 25],
    ['tally-interest-form', interest, 30],
    ['tally-community-interest', community, 12],
    ['tally-product-studio', productStudio, 10],
    ['members-list', members, 8],
  ];

  it.each(counts)('%s parses every row and always has an email', (_name, rows, expected) => {
    expect(rows).toHaveLength(expected);
    expect(rows.every((row) => row.email_normalized !== null)).toBe(true);
  });

  it('flags exactly the test rows the exports contain', () => {
    expect(checkin.filter((row) => row.is_test_row).map((row) => row.email)).toEqual([
      'test@test.edu',
    ]);
    expect(interest.filter((row) => row.is_test_row).map((row) => row.email)).toEqual([
      'test@test.com',
    ]);
    expect(luma.some((row) => row.is_test_row)).toBe(false);
  });
});

describe('luma guest export', () => {
  it('pulls one event id out of every qr_code_url', () => {
    expect(new Set(luma.map((row) => row.luma_event_id))).toEqual(
      new Set(['evt-K7dQ2mNpXrLb9Vt']),
    );
  });

  it('splits `name` when last_name is blank', () => {
    const blanks = luma.filter((row) => ['g-0015', 'g-0018'].includes(row.luma_guest_id ?? ''));
    expect(blanks.map((row) => row.last_name)).toEqual(['Raghavan', 'Ferreira']);
  });

  it('keeps referral fields and never asserts a check-in', () => {
    expect(luma.filter((row) => row.referral_source === 'Meta Ad')).toHaveLength(1);
    expect(luma.every((row) => row.checked_in === null)).toBe(true);
    expect(luma.filter((row) => row.registered === false)).toHaveLength(1);
  });
});

describe('tally check-in', () => {
  it('checks everyone in at their Detroit submission time', () => {
    expect(checkin.every((row) => row.checked_in === true)).toBe(true);
    expect(checkin[0]?.checked_in_at).toBe('2026-09-05T22:02:11.000Z');
  });

  it('keeps unmapped columns in answers under their original label', () => {
    expect(checkin[0]?.answers).toMatchObject({
      'Respondent ID': 'r1000001',
      'Is this your first time at Open House?': 'No',
      'How many times have you attended?': '3',
      _submission_id: 'c1000001',
    });
  });

  it('stores an unrecognised gender as null but keeps the raw value', () => {
    const freya = checkin.find((row) => row.email === 'flind@umich.edu');
    expect(freya?.gender).toBeNull();
    expect(freya?.answers.gender_raw).toBe('cat');
    expect(freya?.student_level).toBe('other');
  });
});

describe('tally interest form', () => {
  it('coalesces `Grade`/`Grade (2)` and `Gender`/`Gender (2)`', () => {
    expect(interest.filter((row) => row.grad_year !== null)).toHaveLength(2);
    expect(interest.find((row) => row.email === 'sofian@umich.edu')?.grad_year).toBe(2029);
    expect(interest.find((row) => row.email === 'jferreira@umich.edu')?.grad_year).toBe(2027);
    expect(interest.find((row) => row.email === 'ikim@umich.edu')?.gender).toBe('female');
  });

  it('stores garbage names as they came in', () => {
    const row = interest.find((entry) => entry.email === 'harisha@umich.edu');
    expect(row).toMatchObject({ first_name: 'Harish Anand', last_name: 'What' });
  });

  it('has duplicate submissions for the same person, as the real export does', () => {
    const emails = interest.map((row) => row.email_normalized);
    expect(emails.length - new Set(emails).size).toBe(4);
  });

  it('normalizes the dotted umich address onto the same key', () => {
    expect(interest.find((row) => row.email === 'p.raghav@umich.edu')?.email_normalized).toBe(
      'praghav@umich.edu',
    );
  });
});

describe('tally community interest form', () => {
  it('stores the multi-select as an array', () => {
    expect(community[0]?.answers['What types of programs are you interested in?']).toEqual([
      'Product Studio (a semester-long build program)',
      'Speaker events (founders, investors, operators)',
    ]);
  });

  it('collapses the three exploded checkbox columns into one answer key', () => {
    const keys = Object.keys(community[0]?.answers ?? {}).filter((key) =>
      key.startsWith('Want to answer a few more questions'),
    );
    expect(keys).toHaveLength(1);
    expect(community[0]?.answers[keys[0]!]).toEqual(['Yes']);
    expect(community[1]?.answers['Want to answer a few more questions to help us plan?']).toEqual([
      'No',
    ]);
  });
});

describe('tally product studio application', () => {
  it('takes the uniqname from the form and keeps tally storage URLs intact', () => {
    expect(productStudio[0]?.uniqname).toBe('avachen');
    expect(productStudio[0]?.answers.Resume).toBe(
      'https://storage.tally.so/private/resume-avachen.pdf?id=aB3dE5f7&accessToken=eyJhbGciOiJIUzI1NiJ9.a1',
    );
  });

  it("maps Grade 'Other' to student_level other with no grad year", () => {
    const elena = productStudio.find((row) => row.email === 'epetrova@umich.edu');
    expect(elena).toMatchObject({ grad_year: null, student_level: 'other', gender: 'prefer_not_to_say' });
  });
});

describe('members roster', () => {
  it('reads member_since and splits the optional name', () => {
    expect(members[0]).toMatchObject({
      email_normalized: 'avachen@umich.edu',
      first_name: 'Ava',
      last_name: 'Chen',
      member_since: '2025-09-15',
    });
    expect(members.find((row) => row.email === 'amehta@umich.edu')?.member_since).toBeNull();
  });
});

describe('matching the check-in fixture against the luma registrations', () => {
  const index = buildPersonIndex(
    luma.map((row, i) => ({
      id: `p${i}`,
      display: `${row.first_name} ${row.last_name}`,
      emails: [row.email_normalized],
      uniqname: row.uniqname,
      name: `${row.first_name ?? ''} ${row.last_name ?? ''}`,
    })),
  );

  it('walk-ins are the norm; only the ambiguous rows need review', () => {
    const tally = { auto: 0, review: 0, created: 0, bad: 0 };
    for (const row of checkin) {
      if (row.is_test_row) {
        tally.bad++;
        continue;
      }
      const result = matchPerson(
        { email: row.email, name: `${row.first_name ?? ''} ${row.last_name ?? ''}` },
        index,
      );
      if (result.personId !== null) tally.auto++;
      else if (result.reason === 'new') tally.created++;
      else tally.review++;
    }
    expect(tally).toEqual({ auto: 7, review: 2, created: 15, bad: 1 });
  });

  it('the two review rows are the typo domain and the same-name gmail address', () => {
    const reasons = checkin
      .filter((row) => !row.is_test_row)
      .map((row) =>
        matchPerson(
          { email: row.email, name: `${row.first_name ?? ''} ${row.last_name ?? ''}` },
          index,
        ),
      )
      .filter((result) => result.personId === null && result.reason !== 'new')
      .map((result) => `${result.reason}:${result.confidence}`);
    expect(reasons.sort()).toEqual(['name_exact:0.7', 'typo_domain_uniqname:0.85']);
  });
});

describe('hashing', () => {
  it('is stable across re-parses and changes when a value does', () => {
    const again = importFixture('tally-checkin', 'event_checkin');
    expect(rowHash(checkin[0]!)).toBe(rowHash(again[0]!));
    expect(rowHash(checkin[0]!)).not.toBe(rowHash(checkin[1]!));
    expect(rowHash({ ...checkin[0]!, major: 'changed' })).not.toBe(rowHash(checkin[0]!));
  });

  it('hashes file bytes', () => {
    expect(fileHash(new TextEncoder().encode('a'))).toMatch(/^[0-9a-f]{64}$/);
  });
});
