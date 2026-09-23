import { describe, expect, it } from 'vitest';
import {
  buildPersonIndex,
  matchPerson,
  type IndexPerson,
  type MatchInput,
} from '@/lib/matching/matchPerson';

const people: IndexPerson[] = [
  {
    id: 'p1',
    display: 'Ava Chen',
    emails: ['avachen@umich.edu'],
    name: 'Ava Chen',
    slackUserId: 'U0AVA',
  },
  {
    id: 'p2',
    display: 'Noah Patel',
    emails: ['noah.patel@gmail.com', 'noahpat@umich.edu'],
    name: 'Noah Patel',
  },
  { id: 'p3', display: 'Maya Rodriguez (Ross)', emails: ['mayarod@umich.edu'], name: 'Maya Rodriguez' },
  { id: 'p4', display: 'Maya Rodriguez (LSA)', emails: ['mrodrig@umich.edu'], name: 'Maya Rodriguez' },
  { id: 'p5', display: 'Nina Kowalski', emails: ['nkowal@umich.edu'], name: 'Nina Kowalski' },
  {
    id: 'p6',
    display: 'Elijah Moreau',
    emails: ['emoreau@umich.edu'],
    name: 'Elijah Moreau',
    slackUserId: 'U0ELI',
  },
  {
    id: 'p7',
    display: 'Priya Raghavan',
    emails: ['praghav@gmail.com'],
    uniqname: 'praghav',
    name: 'Priya Raghavan',
  },
];

const index = buildPersonIndex(people);
const match = (input: MatchInput) => matchPerson(input, index);

describe('rungs 1-3: auto-link at >= 0.9', () => {
  it('1. slack_user_id exact', () => {
    const result = match({ slackUserId: 'U0AVA', name: 'A. Chen' });
    expect(result).toMatchObject({ personId: 'p1', confidence: 1, reason: 'slack_user_id' });
  });

  it('2. normalized email exact, including dotted and +tagged umich addresses', () => {
    expect(match({ email: 'A.Va.Chen+v1@umich.edu' })).toMatchObject({
      personId: 'p1',
      confidence: 1,
      reason: 'email',
    });
  });

  it('2. the same person under gmail and under umich', () => {
    expect(match({ email: 'noah.patel@gmail.com' }).personId).toBe('p2');
    expect(match({ email: 'noahpat@umich.edu' }).personId).toBe('p2');
  });

  it('3. uniqname exact when the address itself is new', () => {
    expect(match({ email: 'praghav@umich.edu' })).toMatchObject({
      personId: 'p7',
      confidence: 0.95,
      reason: 'uniqname',
    });
  });
});

describe('exact names with different emails', () => {
  it('reviews a typo-domain email only when the full name also matches', () => {
    const result = match({ email: 'nkowal@umich.efu', name: 'Nina Kowalski' });
    expect(result).toMatchObject({
      personId: null,
      confidence: 0.85,
      reason: 'name_exact_email_different',
      isConflict: false,
    });
    expect(result.candidates.map((c) => c.person_id)).toEqual(['p5']);
  });

  it('reviews an exact full name with a different email, without auto-linking', () => {
    const result = match({ email: 'elijah.personal@gmail.com', name: 'Elijah Moreau' });
    expect(result).toMatchObject({ personId: null, reason: 'name_exact_email_different', isConflict: false });
    expect(result.candidates.map((c) => c.person_id)).toEqual(['p6']);
  });

  it('ignores nonbreaking spaces copied from spreadsheets', () => {
    expect(match({ email: 'new@gmail.com', name: 'Nina\u00a0Kowalski' })
      .candidates.map((c) => c.person_id)).toEqual(['p5']);
  });

  it('returns all exact-name candidates, excluding people without an email', () => {
    const source = buildPersonIndex([...people,
      { id: 'p8', display: 'Maya Rodriguez', name: 'Maya Rodriguez' },
      { id: 'p9', display: 'Maya Rodriguez', name: 'Maya Rodriguez', emails: ['  ', null] },
    ]);
    const result = matchPerson({ email: 'maya.new@gmail.com', name: 'Maya Rodriguez' }, source);
    expect(result.personId).toBeNull();
    expect(result.candidates.map((c) => c.person_id).sort()).toEqual(['p3', 'p4']);
    expect(result.isConflict).toBe(false);
  });

  it('normalizes case, repeated whitespace, and punctuation without dropping suffixes', () => {
    const source = buildPersonIndex([
      { id: 'jr', name: "Ryan O'Connell Jr.", display: 'Ryan Jr', emails: ['jr@example.com'] },
      { id: 'sr', name: "Ryan O'Connell Sr.", display: 'Ryan Sr', emails: ['sr@example.com'] },
    ]);
    const result = matchPerson({ name: '  RYAN   OCONNELL, JR ', email: 'new@example.com' }, source);
    expect(result.candidates.map((c) => c.person_id)).toEqual(['jr']);
  });

  it('matches accented names without collapsing different non-ASCII names', () => {
    const source = buildPersonIndex([
      { id: 'a', name: 'José García', display: 'José García', emails: ['a@example.com'] },
      { id: 'b', name: 'Josè García', display: 'Josè García', emails: ['b@example.com'] },
    ]);
    expect(matchPerson({ name: 'José García', email: 'new@example.com' }, source)
      .candidates.map((c) => c.person_id)).toEqual(['a']);
  });

  it('treats composed/decomposed accents equally while preserving combining marks', () => {
    const source = buildPersonIndex([
      { id: 'accent', name: 'José García', display: 'José García', emails: ['a@example.com'] },
      { id: 'plain', name: 'Jose Garcia', display: 'Jose Garcia', emails: ['b@example.com'] },
      { id: 'mark', name: 'Q\u0301 Smith', display: 'Q́ Smith', emails: ['c@example.com'] },
      { id: 'no-mark', name: 'Q Smith', display: 'Q Smith', emails: ['d@example.com'] },
    ]);
    expect(matchPerson({ name: 'Jose\u0301 Garci\u0301a', email: 'new@example.com' }, source)
      .candidates.map((c) => c.person_id)).toEqual(['accent']);
    expect(matchPerson({ name: 'Q\u0301 Smith', email: 'new@example.com' }, source)
      .candidates.map((c) => c.person_id)).toEqual(['mark']);
  });

  it.each([null, '', '   '])('does not review a name alone when incoming email is %s', (email) => {
    expect(match({ name: 'Elijah Moreau', email }).reason).toBe('new');
  });

  it('does not review an exact name when the existing person has no email', () => {
    const source = buildPersonIndex([{ id: 'a', display: 'Elijah Moreau', name: 'Elijah Moreau' }]);
    expect(matchPerson({ name: 'Elijah Moreau', email: 'new@example.com' }, source).reason).toBe('new');
  });

  it.each(['Nina Kowalska', 'N. Kowalski', 'Someone Else', null])(
    'does not propose a typo-domain match for a different or absent name: %s', (name) => {
      expect(match({ email: 'nkowal@umich.efu', name }).reason).toBe('new');
    },
  );
});

describe('prefer new people over low-confidence name matches', () => {
  it.each([
    ['a similar name', 'Elijah Morea'],
    ['the same surname with a different first name', 'Elias Moreau'],
    ['a middle-name difference', 'Elijah James Moreau'],
    ['a suffix difference', 'Elijah Moreau Jr.'],
    ['an unrelated name', 'Hana Yusuf'],
  ])('creates a new person for %s without a matching identifier', (_label, name) => {
    expect(match({ email: 'new.person@gmail.com', name })).toEqual({
      personId: null, confidence: 1, candidates: [], reason: 'new', isConflict: false,
    });
  });
});

describe('conflicts (§3.2)', () => {
  it('email says A and slack id says B: review with both, never a merge', () => {
    const result = match({ email: 'avachen@umich.edu', slackUserId: 'U0ELI' });
    expect(result.isConflict).toBe(true);
    expect(result.personId).toBeNull();
    expect(result.reason).toBe('conflict');
    expect(result.candidates.map((c) => c.person_id).sort()).toEqual(['p1', 'p6']);
  });

  it('two keys agreeing on one person is not a conflict', () => {
    const result = match({ email: 'avachen@umich.edu', slackUserId: 'U0AVA' });
    expect(result).toMatchObject({ personId: 'p1', isConflict: false, confidence: 1 });
  });
});
