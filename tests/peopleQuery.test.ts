import { describe, expect, it } from 'vitest';
import {
  parsePeopleQuery, peopleSearchFilter, peopleSearchParams, type PeopleQuery,
} from '@/lib/peopleQuery';

const DEFAULTS: PeopleQuery = {
  q: '', filter: 'all', year: null, sort: 'name', desc: false, page: 0,
};

describe('parsePeopleQuery', () => {
  it('defaults an empty URL', () => {
    expect(parsePeopleQuery({})).toEqual(DEFAULTS);
  });

  it('reads every field', () => {
    expect(parsePeopleQuery({
      q: 'kai', filter: 'members', year: '2027', sort: 'grad_year', dir: 'desc', page: '3',
    })).toEqual({
      q: 'kai', filter: 'members', year: 2027, sort: 'grad_year', desc: true, page: 3,
    });
  });

  // The URL is user input: an unknown sort column would be a 400 from PostgREST.
  it('falls back rather than trusting the URL', () => {
    const bad = parsePeopleQuery({
      filter: 'admins', sort: 'notes; drop table people', year: 'abc', page: '-2',
    });
    expect(bad).toEqual(DEFAULTS);
  });

  it('ignores a repeated param instead of building an array', () => {
    expect(parsePeopleQuery({ page: ['2', '9'] }).page).toBe(2);
  });
});

describe('peopleSearchParams', () => {
  it('leaves defaults out so a plain /people URL stays plain', () => {
    expect(peopleSearchParams(DEFAULTS)).toBe('');
  });

  it('round-trips', () => {
    const q: PeopleQuery = {
      q: 'kai m', filter: 'slack', year: 2028, sort: 'coffee_chats', desc: true, page: 2,
    };
    expect(parsePeopleQuery(
      Object.fromEntries(new URLSearchParams(peopleSearchParams(q))),
    )).toEqual(q);
  });
});

describe('peopleSearchFilter', () => {
  it('is null when there is nothing to search', () => {
    expect(peopleSearchFilter('')).toBeNull();
    expect(peopleSearchFilter('  ')).toBeNull();
  });

  it('normalizes the name half to match people.full_name_normalized', () => {
    expect(peopleSearchFilter("O'Brien")).toContain('full_name_normalized.ilike.%o brien%');
  });

  /*
   * `,` `(` `)` delimit terms inside a PostgREST or=(); one left in a value
   * would change the filter's shape, not just what it matches. Dots are fine —
   * PostgREST splits col.op.value on the first two only — so they stay.
   */
  it('strips the characters that would break the or() grammar', () => {
    const terms = peopleSearchFilter('a,b(c)d%e*')!.split(',');
    expect(terms).toEqual([
      'full_name_normalized.ilike.%a b c d e%',
      'uniqname.ilike.%a b c d e%',
      'primary_email.ilike.%a b c d e%',
    ]);
    for (const t of terms) expect(t.split('.').slice(2).join('.')).not.toMatch(/[,()]/);
  });

  it('still searches uniqname and email when the name normalizes away', () => {
    // normalizeName drops punctuation entirely, so there is no name term left.
    expect(peopleSearchFilter('...')).toBe('uniqname.ilike.%...%,primary_email.ilike.%...%');
  });
});
