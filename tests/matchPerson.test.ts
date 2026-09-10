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

describe('typo domains (§4.8)', () => {
  it('lands in review at 0.85 with the fix pre-filled, never auto-linked', () => {
    const result = match({ email: 'nkowal@umich.efu', name: 'Nina Kowalski' });
    expect(result).toMatchObject({
      personId: null,
      confidence: 0.85,
      reason: 'typo_domain_uniqname',
      isConflict: false,
    });
    expect(result.candidates.map((c) => c.person_id)).toEqual(['p5']);
  });
});

describe('rungs 4-6: the review band and new people', () => {
  it('4. one exact name match is review at 0.7, not an auto-link', () => {
    const result = match({ email: 'elijah.m@gmail.com', name: 'Elijah Moreau' });
    expect(result).toMatchObject({ personId: null, confidence: 0.7, reason: 'name_exact' });
    expect(result.candidates.map((c) => c.person_id)).toEqual(['p6']);
  });

  it('5. two people with the same name go to review with both listed', () => {
    const result = match({ email: 'maya.r@gmail.com', name: 'Maya Rodriguez' });
    expect(result.personId).toBeNull();
    expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    expect(result.confidence).toBeLessThan(0.9);
    expect(result.candidates.map((c) => c.person_id).sort()).toEqual(['p3', 'p4']);
  });

  it('5. a near-miss name is review, in the 0.4-0.69 band', () => {
    const result = match({ email: 'elijahm@umich.edu', name: 'Elijah Morea' });
    expect(result.reason).toBe('name_trigram');
    expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    expect(result.confidence).toBeLessThanOrEqual(0.69);
  });

  it('6. nothing close is a new person', () => {
    const result = match({ email: 'hyusuf@umich.edu', name: 'Hana Yusuf' });
    expect(result).toMatchObject({ personId: null, confidence: 1, reason: 'new' });
    expect(result.candidates).toEqual([]);
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
