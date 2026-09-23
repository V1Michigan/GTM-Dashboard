import type { MatchCandidate } from '@/lib/types';
import { normalizeEmail, normalizeMatchName, uniqnameFromEmail } from './normalize';

/**
 * TS mirror of the `match_person` SQL ladder (spec §3.2) used for dry-run
 * previews. Bulk import runs the SQL version; both must agree.
 */

export const AUTO_LINK_THRESHOLD = 0.9;
export const REVIEW_MIN_CONFIDENCE = 0.85;

export interface MatchInput {
  email?: string | null;
  name?: string | null;
  uniqname?: string | null;
  slackUserId?: string | null;
}

/** One row of the people table, as much of it as matching needs. */
export interface IndexPerson {
  id: string;
  display: string;
  emails?: readonly (string | null | undefined)[];
  uniqname?: string | null;
  name?: string | null;
  slackUserId?: string | null;
}

export interface PersonIndex {
  bySlack: Map<string, string>;
  byEmail: Map<string, string>;
  byUniqname: Map<string, string>;
  byName: Map<string, string[]>;
  emailsByPerson: Map<string, Set<string>>;
  display: Map<string, string>;
}

export interface MatchResult {
  personId: string | null;
  confidence: number;
  candidates: MatchCandidate[];
  reason: string;
  isConflict: boolean;
}

/** One pass over the people an import can match against; a dry run then costs no queries. */
export function buildPersonIndex(people: readonly IndexPerson[]): PersonIndex {
  const index: PersonIndex = {
    bySlack: new Map(),
    byEmail: new Map(),
    byUniqname: new Map(),
    byName: new Map(),
    emailsByPerson: new Map(),
    display: new Map(),
  };
  for (const person of people) addPersonToIndex(index, person);
  return index;
}

/**
 * Add one person to an existing index.
 *
 * A dry run needs this because `apply_import` walks its rows in order: a person
 * created at row 500 is matchable by row 900 through its email or identifier,
 * keeping the preview consistent with the commit.
 */
export function addPersonToIndex(index: PersonIndex, person: IndexPerson): void {
  index.display.set(person.id, person.display);
  if (person.slackUserId) index.bySlack.set(person.slackUserId, person.id);
  const emails = new Set((person.emails ?? [])
    .filter((email): email is string => Boolean(email?.trim()))
    .map(normalizeEmail));
  index.emailsByPerson.set(person.id, emails);
  for (const email of emails) index.byEmail.set(email, person.id);
  const uniqname =
    person.uniqname?.trim().toLowerCase() ??
    person.emails?.map((e) => (e ? uniqnameFromEmail(e) : null)).find(Boolean) ??
    null;
  if (uniqname) index.byUniqname.set(uniqname, person.id);
  const name = person.name ? normalizeMatchName(person.name) : '';
  if (name !== '') {
    index.byName.set(name, [...(index.byName.get(name) ?? []), person.id]);
  }
}

export function matchPerson(input: MatchInput, candidatesSource: PersonIndex): MatchResult {
  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  const uniqname =
    input.uniqname?.trim().toLowerCase() || (email ? uniqnameFromEmail(email) : null);
  const name = input.name ? normalizeMatchName(input.name) : '';

  const candidate = (id: string, confidence: number, reason: string): MatchCandidate => ({
    person_id: id,
    confidence,
    reason,
    display: candidatesSource.display.get(id) ?? id,
  });

  // Ladder order, one entry per person: a umich address hits rungs 2 and 3 for the same row.
  const hits: MatchCandidate[] = [];
  const add = (id: string | undefined, confidence: number, reason: string) => {
    if (id !== undefined && !hits.some((hit) => hit.person_id === id)) {
      hits.push(candidate(id, confidence, reason));
    }
  };
  add(input.slackUserId ? candidatesSource.bySlack.get(input.slackUserId) : undefined, 1, 'slack_user_id');
  add(email ? candidatesSource.byEmail.get(email) : undefined, 1, 'email');
  add(uniqname ? candidatesSource.byUniqname.get(uniqname) : undefined, 0.95, 'uniqname');

  // Two different people above the auto-link threshold through different keys is a conflict.
  const strong = hits.filter((h) => h.confidence >= AUTO_LINK_THRESHOLD);
  if (new Set(strong.map((h) => h.person_id)).size > 1) {
    return {
      personId: null,
      confidence: Math.max(...strong.map((h) => h.confidence)),
      candidates: strong,
      reason: 'conflict',
      isConflict: true,
    };
  }
  const best = hits[0];
  if (best) {
    return {
      personId: best.confidence >= AUTO_LINK_THRESHOLD ? best.person_id : null,
      confidence: best.confidence,
      candidates: hits,
      reason: best.reason,
      isConflict: false,
    };
  }

  // Duplicate review requires the same full name AND two present, different
  // emails. Similar names and typo domains alone are not evidence of a match.
  // Exact identifiers above remain authoritative; names never auto-link.
  const exact = email && name ? (candidatesSource.byName.get(name) ?? []).filter((id) => {
    const known = candidatesSource.emailsByPerson.get(id);
    return known && known.size > 0 && !known.has(email);
  }).sort() : [];
  if (exact.length > 0) {
    return {
      personId: null,
      confidence: REVIEW_MIN_CONFIDENCE,
      candidates: exact.map((id) => candidate(id, REVIEW_MIN_CONFIDENCE, 'name_exact_email_different')),
      reason: 'name_exact_email_different',
      isConflict: false,
    };
  }

  return { personId: null, confidence: 1, candidates: [], reason: 'new', isConflict: false };
}
