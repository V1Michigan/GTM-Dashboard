import Link from 'next/link';
import { DownloadSimple } from '@phosphor-icons/react/dist/ssr';

/**
 * The one place the export surface is described. `/settings` renders the button
 * row; `/export` renders the same routes as feature cards plus the per-table
 * list. The API routes themselves live in app/api/export.
 */
export const EXPORT_TABLES = [
  { table: 'people', description: 'Canonical person records' },
  { table: 'person_emails', description: 'All known emails, one primary per person' },
  { table: 'events', description: 'Events with Luma / Tally ids' },
  { table: 'event_attendance', description: 'Registration and check-in per (event, person)' },
  { table: 'form_submissions', description: 'Interest forms with answers JSON' },
  { table: 'product_studio_applications', description: 'Per (person, semester, year)' },
  { table: 'coffee_chats', description: 'Member ↔ person chats' },
  { table: 'slack_channels', description: 'Channel metadata and bot membership' },
  { table: 'slack_channel_activity', description: 'Daily message counts per person and channel' },
  { table: 'person_organizations', description: 'Empty in v1' },
] as const;

/** Spec §7, in order. The per-event `evt_<date>_<slug>` columns follow these. */
export const PEOPLE_WIDE_COLUMNS = [
  'person_id', 'first_name', 'last_name', 'primary_email', 'all_emails', 'uniqname',
  'grad_year', 'grad_term', 'major', 'gender', 'is_v1_member', 'member_since', 'in_slack',
  'slack_joined_at', 'slack_channels_active', 'events_registered', 'events_attended',
  'ps_applications', 'coffee_chat_members', 'organizations',
] as const;

export const csvHref = (table: string) => `/api/export/${table}.csv`;
export const ZIP_HREF = '/api/export/all.zip';

/** The button row on `/settings`; `/export` is the full version of the same thing. */
export function ExportButtons() {
  return (
    <div className="flex flex-wrap gap-2">
      <a className="btn btn-primary" href={ZIP_HREF} download>
        <DownloadSimple size={16} aria-hidden />
        Download everything (.zip)
      </a>
      {['people_wide', 'people', 'events', 'event_attendance'].map((t) => (
        <a key={t} className="btn btn-secondary" href={csvHref(t)} download>{t}.csv</a>
      ))}
      <Link className="btn btn-ghost text-neutral-400" href="/export">More tables…</Link>
    </div>
  );
}
