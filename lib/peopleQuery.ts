import { normalizeName } from '@/lib/matching/normalize';

/**
 * The /people table's state, which lives entirely in the URL: the server reads
 * it to build one page of rows, the client writes it to ask for another. Pure
 * on purpose — no DB, no cookies — so both sides and the tests can import it.
 */

export const PEOPLE_PAGE = 50;

export type PeopleFilter = 'all' | 'members' | 'slack' | 'no-slack';
export const PEOPLE_FILTERS: PeopleFilter[] = ['all', 'members', 'slack', 'no-slack'];

export interface PeopleQuery {
  q: string;
  filter: PeopleFilter;
  year: number | null;
  sort: string;
  desc: boolean;
  page: number;
}

/**
 * Columns /people may sort by, mapped to the people_list columns that order
 * them. `sort` arrives from the URL, so it is resolved through this table
 * rather than passed to PostgREST — an unknown column is a 400 from the
 * database, and the UI's `name` is two columns underneath.
 */
export const PEOPLE_SORT: Record<string, string[]> = {
  name: ['last_name', 'first_name'],
  primary_email: ['primary_email'],
  grad_year: ['grad_year'],
  major: ['major'],
  is_v1_member: ['is_v1_member'],
  slack: ['slack_joined_at'],
  events_registered: ['events_registered'],
  events_attended: ['events_attended'],
  ps_applications: ['ps_applications'],
  coffee_chats: ['coffee_chats'],
  gender: ['gender'],
  uniqname: ['uniqname'],
  notes: ['notes'],
  member_since: ['member_since'],
};

export const isPeopleSort = (s: string) => Object.hasOwn(PEOPLE_SORT, s);

/** `,`, `(` and `)` end a PostgREST `or=()` term; `%` and `*` are its wildcards. */
export const forFilter = (s: string) => s.replace(/[,()*%\\]/g, ' ').trim();

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export function parsePeopleQuery(sp: Params): PeopleQuery {
  const filter = one(sp.filter) as PeopleFilter;
  const year = Number(one(sp.year));
  const sort = one(sp.sort);
  const page = Number(one(sp.page));
  return {
    q: one(sp.q),
    filter: PEOPLE_FILTERS.includes(filter) ? filter : 'all',
    year: Number.isInteger(year) && year > 0 ? year : null,
    sort: isPeopleSort(sort) ? sort : 'name',
    desc: one(sp.dir) === 'desc',
    page: Number.isInteger(page) && page > 0 ? page : 0,
  };
}

/** The inverse. Defaults are left out so a plain /people URL stays plain. */
export function peopleSearchParams(query: PeopleQuery): string {
  const p = new URLSearchParams();
  if (query.q) p.set('q', query.q);
  if (query.filter !== 'all') p.set('filter', query.filter);
  if (query.year !== null) p.set('year', String(query.year));
  if (query.sort !== 'name') p.set('sort', query.sort);
  if (query.desc) p.set('dir', 'desc');
  if (query.page > 0) p.set('page', String(query.page));
  return p.toString();
}

/**
 * The `or=()` term for a search box query, or null for no search. Matches what
 * the old client-side filter did — name, uniqname, email — except the name half
 * goes through the same normalizer that fills people.full_name_normalized, so
 * it can use people_full_name_trgm.
 */
export function peopleSearchFilter(q: string): string | null {
  const clean = forFilter(q);
  if (!clean) return null;
  const name = forFilter(normalizeName(clean));
  return [
    ...(name ? [`full_name_normalized.ilike.%${name}%`] : []),
    `uniqname.ilike.%${clean}%`,
    `primary_email.ilike.%${clean}%`,
  ].join(',');
}
