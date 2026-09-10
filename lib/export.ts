import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Export (spec §7). One map drives both routes: `/api/export/<table>.csv` streams
 * one raw table with its ids, `/api/export/all.zip` streams all of them plus the
 * human-readable `people_wide.csv`.
 */

/** Table -> the columns to order by. `.range()` without an order can repeat rows. */
export const EXPORT_TABLES = {
  people: ['id'],
  person_emails: ['id'],
  events: ['id'],
  event_attendance: ['id'],
  form_submissions: ['id'],
  product_studio_applications: ['id'],
  coffee_chats: ['id'],
  slack_channels: ['id'],
  slack_channel_activity: ['person_id', 'channel_id', 'activity_date'],
  person_organizations: ['id'],
} satisfies Record<string, string[]>;

export type ExportTable = keyof typeof EXPORT_TABLES;

export const isExportTable = (t: string): t is ExportTable => t in EXPORT_TABLES;

type Row = Record<string, unknown>;

const PAGE = 1000;

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export const csvRow = (values: unknown[]): string => `${values.map(cell).join(',')}\n`;

async function page(db: SupabaseClient, table: string, order: string[], from: number): Promise<Row[]> {
  let q = db.from(table).select('*').range(from, from + PAGE - 1);
  for (const col of order) q = q.order(col);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Row[];
}

async function all(db: SupabaseClient, table: string, order: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (;;) {
    const batch = await page(db, table, order, rows.length);
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

/** One raw table as CSV, a page at a time. */
export async function* csvChunks(db: SupabaseClient, table: ExportTable): AsyncGenerator<string> {
  let from = 0;
  let columns: string[] | null = null;
  for (;;) {
    const rows = await page(db, table, EXPORT_TABLES[table], from);
    if (!columns) {
      columns = Object.keys(rows[0] ?? {});
      yield csvRow(columns);
    }
    for (const r of rows) yield csvRow(columns.map((c) => r[c]));
    from += rows.length;
    if (rows.length < PAGE) return;
  }
}

/** Async iterable of strings -> a streamed response body. */
export function toStream(chunks: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const it = chunks[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await it.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
  });
}

/** ISO timestamp for file names (§7), filesystem-safe. */
export const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const join = (xs: (string | null | undefined)[]) => xs.filter(Boolean).join(';');
const personName = (p: Row) => [p.first_name, p.last_name].filter(Boolean).join(' ');

/**
 * `people_wide.csv`: one row per person, the columns of §7 in that exact order,
 * ending with one column per event holding `registered|attended|both|none`.
 * The joins happen here rather than in SQL because this is the one read that is
 * genuinely wide and one-off; every dashboard count still comes from a view.
 */
export async function buildPeopleWide(db: SupabaseClient): Promise<string> {
  const [people, emails, events, attendance, activity, channels, apps, chats, orgs, summary] =
    await Promise.all([
      all(db, 'people', ['id']),
      all(db, 'person_emails', ['id']),
      all(db, 'events', ['event_date', 'name']),
      all(db, 'event_attendance', ['id']),
      all(db, 'slack_channel_activity', ['person_id', 'channel_id', 'activity_date']),
      all(db, 'slack_channels', ['id']),
      all(db, 'product_studio_applications', ['id']),
      all(db, 'coffee_chats', ['id']),
      all(db, 'person_organizations', ['id']),
      all(db, 'person_event_summary', ['person_id']),
    ]);

  const byPerson = <T>(rows: Row[], value: (r: Row) => T) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = r.person_id as string;
      if (!k) continue;
      const list = m.get(k) ?? [];
      list.push(value(r));
      m.set(k, list);
    }
    return m;
  };

  const names = new Map(people.map((p) => [p.id as string, personName(p)]));
  const channelName = new Map(channels.map((c) => [c.id as string, c.name as string]));
  const primary = new Map(
    emails.filter((e) => e.is_primary).map((e) => [e.person_id as string, e.email as string]),
  );
  const allEmails = byPerson(emails, (e) => e.email as string);
  const slackChannels = byPerson(activity, (a) => channelName.get(a.channel_id as string) ?? (a.channel_id as string));
  const psApps = byPerson(apps, (a) => `${a.semester === 'fall' ? 'F' : 'W'}${a.year}:${a.round_reached}`);
  const chatMembers = byPerson(chats, (c) => names.get(c.member_id as string) ?? '');
  const organizations = byPerson(orgs, (o) => o.organization as string);
  const summaries = new Map(summary.map((s) => [s.person_id as string, s]));

  const state = new Map<string, string>();
  for (const a of attendance) {
    const value = a.registered && a.checked_in ? 'both' : a.checked_in ? 'attended' : a.registered ? 'registered' : 'none';
    state.set(`${a.person_id}|${a.event_id}`, value);
  }

  const columns = [
    'person_id', 'first_name', 'last_name', 'primary_email', 'all_emails', 'uniqname',
    'grad_year', 'grad_term', 'major', 'gender', 'is_v1_member', 'member_since', 'in_slack',
    'slack_joined_at', 'slack_channels_active', 'events_registered', 'events_attended',
    'ps_applications', 'coffee_chat_members', 'organizations',
    ...events.map((e) => `evt_${e.event_date}_${slug(e.name as string)}`),
  ];

  let csv = csvRow(columns);
  for (const p of people) {
    const id = p.id as string;
    const s = summaries.get(id);
    csv += csvRow([
      id, p.first_name, p.last_name, primary.get(id) ?? null, join(allEmails.get(id) ?? []),
      p.uniqname, p.grad_year, p.grad_term, p.major, p.gender, p.is_v1_member, p.member_since,
      p.slack_joined_at != null, p.slack_joined_at,
      join([...new Set(slackChannels.get(id) ?? [])]),
      s?.events_registered ?? 0, s?.events_attended ?? 0,
      join(psApps.get(id) ?? []), join([...new Set(chatMembers.get(id) ?? [])]),
      join(organizations.get(id) ?? []),
      ...events.map((e) => state.get(`${id}|${e.id}`) ?? 'none'),
    ]);
  }
  return csv;
}
