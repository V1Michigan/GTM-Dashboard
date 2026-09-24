/** Normalization rules from spec §3.2, plus the test-row rule from §4.8. */

const UMICH = 'umich.edu';

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at < 1) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  // umich addresses carry no dots or +tags, but people type them (§3.2).
  if (domain !== UMICH) return trimmed;
  return `${local.split('+')[0]!.replaceAll('.', '')}@${domain}`;
}

export function uniqnameFromEmail(email: string): string | null {
  const [local, domain] = normalizeEmail(email).split('@');
  return domain === UMICH && local ? local : null;
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token !== '' && !NAME_SUFFIXES.has(token))
    .join(' ');
}

// Keep this explicit set in sync with normalize_match_name() in SQL. A broad
// non-letter regex drops combining marks and can conflate different names.
const MATCH_PUNCTUATION = new Set(Array.from('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~‐‑‒–—―‘’‚‛“”„‟'));

/** Strict duplicate matching: preserve every name token, including suffixes. */
export function normalizeMatchName(name: string): string {
  return Array.from(name.normalize('NFC').toLowerCase())
    .filter((character) => !MATCH_PUNCTUATION.has(character)).join('')
    .trim().replace(/\s+/g, ' ');
}

export function splitName(full: string): { first: string | null; last: string | null } {
  const name = full.trim().replace(/\s+/g, ' ');
  if (name === '') return { first: null, last: null };
  const cut = name.lastIndexOf(' ');
  return cut === -1
    ? { first: name, last: null }
    : { first: name.slice(0, cut), last: name.slice(cut + 1) };
}

export function isTestRow(input: { email?: string | null; name?: string | null }): boolean {
  const [local, domain] = (input.email ?? '').trim().toLowerCase().split('@');
  return (
    /^test\./.test(domain ?? '') ||
    local === 'test' ||
    normalizeName(input.name ?? '') === 'test'
  );
}
