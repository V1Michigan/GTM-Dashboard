import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Buildings, Coffee } from '@phosphor-icons/react/dist/ssr';
import { Empty, Section, Tag } from '@/components/ui/primitives';
import { getPerson, peopleDirectory, type PersonDetail } from '@/lib/queries';
import type { Json } from '@/lib/types';
import { addEmail, removeEmail, setPrimaryEmail } from '../actions';
import { PersonHeader } from './PersonHeader';

const fmtDate = (v: string | null) =>
  v ? new Date(v.length === 10 ? `${v}T00:00:00` : v)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
const fmtTime = (v: string | null) =>
  v ? new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
const fmtStamp = (v: string) =>
  new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const title = (v: string) => v.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
const show = (v: Json) => v === null || v === undefined ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v);

const MUTED = 'text-neutral-600';
const dash = <span className={MUTED}>—</span>;

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, directory] = await Promise.all([getPerson(id), peopleDirectory()]);
  if (!detail) notFound();

  const { person, emails, attendance, submissions, applications, chats, slack, organizations, audit } = detail;
  const name = [person.first_name, person.last_name].filter(Boolean).join(' ') || '(no name)';
  const events = [...attendance].sort((a, b) => b.event.event_date.localeCompare(a.event.event_date));

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="text-[12.5px] text-neutral-500">
        <Link href="/people" className="text-neutral-400 no-underline">People</Link> / {name}
      </div>

      <PersonHeader
        person={person}
        name={name}
        directory={directory}
        merge={{
          id: person.id, name, emails: emails.length, events: attendance.length,
          applications: applications.length, createdOn: fmtDate(person.created_at) ?? '—',
        }}
        cascades={{
          emails: emails.length, attendance: attendance.length, submissions: submissions.length,
          applications: applications.length, chats: chats.length, slack: slack.length,
        }}
      />

      <div className="grid grid-cols-2 items-start gap-5">
        <div className="flex flex-col gap-5">
          <Section title="Emails">
            <table className="table table-dense">
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id}>
                    <td>{e.email}</td>
                    <td>
                      {e.is_primary ? <Tag tone="accent">Primary</Tag> : (
                        <form action={setPrimaryEmail.bind(null, person.id, e.id)}>
                          <button className="cursor-pointer text-[12px] text-accent">Set primary</button>
                        </form>
                      )}
                    </td>
                    <td className="text-neutral-500">{e.source}</td>
                    <td className="num">
                      <form action={removeEmail.bind(null, person.id, e.id)}>
                        <button className="cursor-pointer text-[12px] text-neutral-500">Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
                {emails.length === 0 && (
                  <tr><td className={MUTED}>No email addresses on file.</td></tr>
                )}
              </tbody>
            </table>
            <form action={addEmail.bind(null, person.id)} className="flex gap-2">
              <input
                className="input" type="email" name="email" required
                placeholder="Add another email address" aria-label="Add another email address"
              />
              <button className="btn btn-secondary shrink-0">Add email</button>
            </form>
          </Section>

          <Section
            title="Events"
            actions={
              <span className="text-[12px] text-neutral-500">
                {events.filter((e) => e.registered).length} registered ·{' '}
                {events.filter((e) => e.checked_in).length} attended
              </span>
            }
          >
            {events.length === 0 ? <EmptyPanel>No event history yet.</EmptyPanel> : (
              <table className="table table-dense">
                <thead>
                  <tr><th>Event</th><th>Date</th><th>Registered</th><th>Checked in</th></tr>
                </thead>
                <tbody>
                  {events.map((a) => (
                    <tr key={a.id} className="row-link">
                      <td>
                        <Link href={`/events/${a.event_id}`} className="text-text no-underline">
                          {a.event.name}
                        </Link>
                      </td>
                      <td className="text-neutral-400">{fmtDate(a.event.event_date)}</td>
                      <td>
                        {a.registered
                          ? <>Yes{a.luma_approval_status && <span className="text-neutral-500"> · {a.luma_approval_status}</span>}</>
                          : <span className={MUTED}>No</span>}
                      </td>
                      <td>
                        {a.checked_in
                          ? <>Yes{fmtTime(a.checked_in_at) && <span className="text-neutral-500"> · {fmtTime(a.checked_in_at)}</span>}</>
                          : <span className={MUTED}>{a.registered ? 'No-show' : '—'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Form submissions">
            {submissions.length === 0 ? <EmptyPanel>No form submissions.</EmptyPanel> : (
              <div className="flex flex-col gap-2 text-[13px]">
                {submissions.map((s) => (
                  <div key={s.id} className="flex flex-col gap-2">
                    <div className="flex justify-between">
                      <span>{title(s.form_kind)}</span>
                      <span className="text-neutral-500">{fmtDate(s.submitted_at)}</span>
                    </div>
                    <div className="grid grid-cols-[220px_1fr] gap-x-3 gap-y-1 rounded-md bg-bg px-[10px] py-2 text-[12.5px]">
                      {Object.entries(s.answers).map(([k, v]) => (
                        <div key={k} className="contents">
                          <span className="text-neutral-500">{k}</span>
                          <span>{show(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Product Studio applications">
            {applications.length === 0 ? <EmptyPanel>No applications.</EmptyPanel> : (
              <table className="table table-dense">
                <thead><tr><th>Term</th><th>Round reached</th><th>Submitted</th><th>Notes</th></tr></thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id}>
                      <td>{title(a.semester)} {a.year}</td>
                      <td><Tag tone="neutral">{a.round_reached}</Tag></td>
                      <td className="text-neutral-400"><Empty value={fmtDate(a.submitted_at)} /></td>
                      <td><Empty value={a.outcome_notes} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-5">
          <Section title="Coffee chats">
            {chats.length === 0 ? (
              <EmptyPanel>
                <span className="flex items-center gap-2"><Coffee size={16} /> No coffee chats logged yet</span>
                <Link href={`/coffee-chats/log?person=${person.id}`} className="text-[12px]">Log one</Link>
              </EmptyPanel>
            ) : (
              <table className="table table-dense">
                <thead><tr><th>With</th><th>Date</th><th>Notes</th></tr></thead>
                <tbody>
                  {chats.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/people/${c.other.id}`} className="text-text no-underline">
                          {[c.other.first_name, c.other.last_name].filter(Boolean).join(' ') || '(no name)'}
                        </Link>
                        <span className="text-neutral-500"> · {c.direction}</span>
                      </td>
                      <td className="text-neutral-400"><Empty value={fmtDate(c.chatted_on)} /></td>
                      <td><Empty value={c.notes} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title="Slack"
            actions={
              <span className="text-[12px] text-neutral-500">
                {person.slack_joined_at
                  ? `Joined ${fmtDate(person.slack_joined_at)}${person.slack_user_id ? ` · ${person.slack_user_id}` : ''}`
                  : 'Not in Slack'}
              </span>
            }
          >
            {slack.length === 0 ? <EmptyPanel>No channel activity recorded.</EmptyPanel> : (
              <table className="table table-dense">
                <thead>
                  <tr><th>Channel</th><th className="num">Last 30d</th><th className="num">All time</th></tr>
                </thead>
                <tbody>
                  {rollUp(slack).map((c) => (
                    <tr key={c.name}>
                      <td>#{c.name}</td>
                      <td className="num">{c.last30}</td>
                      <td className="num">{c.all}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className={`text-[11px] ${MUTED}`}>
              Daily counts only. Message contents are never stored.
            </div>
          </Section>

          <Section title="Organizations">
            {organizations.length === 0 ? (
              <EmptyPanel>
                <span className="flex items-center gap-2">
                  <Buildings size={16} /> None recorded. Organization data arrives in a later version.
                </span>
              </EmptyPanel>
            ) : (
              <table className="table table-dense">
                <tbody>
                  {organizations.map((o) => (
                    <tr key={o.id}>
                      <td>{o.organization}</td>
                      <td><Empty value={o.role} /></td>
                      <td className="text-neutral-500">{o.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Audit log">
            {audit.length === 0 ? <EmptyPanel>No changes recorded yet.</EmptyPanel> : (
              <div className="flex flex-col gap-[6px] text-[12.5px]">
                {audit.map((c) => (
                  <div key={c.id} className="grid grid-cols-[110px_1fr] gap-[10px]">
                    <span className="text-neutral-500">{fmtStamp(c.created_at)}</span>
                    <span>
                      <code className="text-[12px]">{c.field}</code> {show(c.old_value)} → {show(c.new_value)}
                      <span className="text-neutral-500"> · {c.source}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

/** Activity rows are per channel per day; the card shows one row per channel. */
function rollUp(rows: PersonDetail['slack']) {
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const byChannel = new Map<string, { name: string; last30: number; all: number }>();
  for (const r of rows) {
    const name = r.channel?.name ?? r.channel_id;
    const entry = byChannel.get(name) ?? { name, last30: 0, all: 0 };
    entry.all += r.message_count;
    if (r.activity_date >= cutoff) entry.last30 += r.message_count;
    byChannel.set(name, entry);
  }
  return [...byChannel.values()].sort((a, b) => b.all - a.all);
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-neutral-700 p-[14px] text-[13px] text-neutral-500">
      {children}
    </div>
  );
}
