/** Normalization rules from spec §3.2, plus the test-row and typo-domain rules from §4.8. */

const UMICH = 'umich.edu';

/** Spec §4.8 says distance 2 but lists `umich.com`, which is 3 away; the examples win. */
const TYPO_MAX_DISTANCE = 3;

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

/** Levenshtein distance of the email's domain from `umich.edu`; null if not close. */
export function typoDomainDistance(email: string): number | null {
  const domain = normalizeEmail(email).split('@')[1];
  if (!domain) return null;
  const distance = levenshtein(domain, UMICH);
  return distance <= TYPO_MAX_DISTANCE ? distance : null;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}
