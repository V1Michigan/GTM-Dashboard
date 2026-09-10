import type { MatchCandidate } from '@/lib/types';
import { normalizeEmail, normalizeName, typoDomainDistance, uniqnameFromEmail } from './normalize';

/**
 * TS mirror of the `match_person` SQL ladder (spec §3.2) used for dry-run
 * previews. Bulk import runs the SQL version; both must agree.
 */

export const AUTO_LINK_THRESHOLD = 0.9;
export const REVIEW_MIN_CONFIDENCE = 0.4;
export const TRIGRAM_THRESHOLD = 0.6;

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
  names: { id: string; grams: Set<string> }[];
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
    names: [],
    display: new Map(),
  };
  for (const person of people) {
    index.display.set(person.id, person.display);
    if (person.slackUserId) index.bySlack.set(person.slackUserId, person.id);
    for (const email of person.emails ?? []) {
      if (email) index.byEmail.set(normalizeEmail(email), person.id);
    }
    const uniqname =
      person.uniqname?.trim().toLowerCase() ??
      person.emails?.map((e) => (e ? uniqnameFromEmail(e) : null)).find(Boolean) ??
      null;
    if (uniqname) index.byUniqname.set(uniqname, person.id);
    const name = person.name ? normalizeName(person.name) : '';
    if (name !== '') {
      index.byName.set(name, [...(index.byName.get(name) ?? []), person.id]);
      index.names.push({ id: person.id, grams: trigrams(name) });
    }
  }
  return index;
}

export function matchPerson(input: MatchInput, candidatesSource: PersonIndex): MatchResult {
  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  const uniqname =
    input.uniqname?.trim().toLowerCase() || (email ? uniqnameFromEmail(email) : null);
  const name = input.name ? normalizeName(input.name) : '';

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

  // §3.2: two different people at >= 0.9 through different keys is a conflict. Never auto-merge.
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

  // §4.8: a domain close to umich.edu means the local part is a uniqname candidate,
  // at 0.85 so it lands in review with the fix pre-filled. Never rewrite the address.
  const distance = email ? typoDomainDistance(email) : null;
  if (email && distance !== null && distance > 0) {
    const guess = uniqnameFromEmail(email.replace(/@.*$/, '@umich.edu'));
    const hit = guess ? candidatesSource.byUniqname.get(guess) : undefined;
    if (hit) {
      return {
        personId: null,
        confidence: 0.85,
        candidates: [candidate(hit, 0.85, 'typo_domain_uniqname')],
        reason: 'typo_domain_uniqname',
        isConflict: false,
      };
    }
  }

  const exact = name === '' ? [] : candidatesSource.byName.get(name) ?? [];
  if (exact.length === 1) {
    return {
      personId: null,
      confidence: 0.7,
      candidates: [candidate(exact[0]!, 0.7, 'name_exact')],
      reason: 'name_exact',
      isConflict: false,
    };
  }

  if (name !== '') {
    const grams = trigrams(name);
    const similar = candidatesSource.names
      .map((entry) => ({ id: entry.id, similarity: dice(grams, entry.grams) }))
      .filter((entry) => entry.similarity >= TRIGRAM_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)
      .map((entry) => candidate(entry.id, trigramConfidence(entry.similarity), 'name_trigram'));
    if (similar.length > 0) {
      return {
        personId: null,
        confidence: similar[0]!.confidence,
        candidates: similar,
        reason: 'name_trigram',
        isConflict: false,
      };
    }
  }

  return { personId: null, confidence: 1, candidates: [], reason: 'new', isConflict: false };
}

/** §3.2 rung 5: similarity 0.6..1.0 maps onto the 0.4..0.69 review band. */
function trigramConfidence(similarity: number): number {
  const scaled = 0.4 + ((similarity - TRIGRAM_THRESHOLD) / (1 - TRIGRAM_THRESHOLD)) * 0.29;
  return Math.round(scaled * 100) / 100;
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}
