import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import type { ImportKind } from '@/lib/types';
import { rowSchema, type ParsedRow } from './schemas';

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  return { headers: result.meta.fields ?? [], rows: result.data };
}

/**
 * `mapping` is header -> canonical field, so several columns may feed one field
 * (`Grade`, `Grade (2)`); the first non-blank in column order wins (§4.8).
 * Unmapped headers survive under their original label in `parsed.answers`.
 */
export function applyMapping(
  row: Record<string, string | undefined>,
  mapping: Record<string, string>,
  kind: ImportKind,
): { parsed: ParsedRow; unmapped: Record<string, string> } {
  const fields: Record<string, string> = {};
  const unmapped: Record<string, string> = {};
  for (const [header, cell] of Object.entries(row)) {
    const trimmed = (cell ?? '').trim();
    if (trimmed === '') continue;
    const field = mapping[header] ?? mapping[header.trim()];
    if (field === undefined) unmapped[header] = trimmed;
    else if (!(field in fields)) fields[field] = trimmed;
  }
  return { parsed: rowSchema(kind).parse({ fields, unmapped }), unmapped };
}

export function rowHash(parsed: ParsedRow): string {
  return sha256(JSON.stringify(sortKeys(parsed)));
}

export function fileHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Stable key order so an unchanged row hashes the same on every re-upload. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortKeys(record[key])]),
  );
}
