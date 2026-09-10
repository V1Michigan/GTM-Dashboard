import Link from 'next/link';
import { UsersSection, type UserRow } from './UsersSection';
import { ExportButtons } from '@/components/ExportButtons';
import { PageHeader, Tag } from '@/components/ui/primitives';
import { requireAdmin } from '@/lib/auth';
import { appUsers, savedMappings } from '@/lib/queries';

const NAV = [
  ['users', 'Users & roles'], ['mappings', 'Column mappings'],
  ['export', 'Export'], ['integrations', 'Integrations'],
] as const;

const shortDate = (t: string) =>
  new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Secrets are read server-side and only their presence ever reaches the page. */
const present = (v: string | undefined) => (v ? 'set' : 'missing');

function Integration(
  { title, tone, status, lines }:
  { title: string; tone: 'accent' | 'outline' | 'neutral'; status: string; lines: string[] },
) {
  return (
    <div className="card elev-sm gap-2 px-4 py-[14px]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[14px]">{title}</h3>
        <Tag tone={tone}>{status}</Tag>
      </div>
      <div className="flex flex-col gap-[3px] text-[12.5px] text-neutral-400">
        {lines.map((l) => <span key={l}>{l}</span>)}
      </div>
    </div>
  );
}

export default async function SettingsPage() {
  const [session, users, mappings] = await Promise.all([
    requireAdmin(), appUsers(), savedMappings(),
  ]);

  const rows: UserRow[] = users.map((u) => ({
    email: u.email,
    role: u.role,
    person: [u.person?.first_name, u.person?.last_name].filter(Boolean).join(' ') || null,
    added: u.added_by ? shortDate(u.created_at) : `${shortDate(u.created_at)} · auto`,
  }));

  const env = process.env;
  const slackConnected = Boolean(env.SLACK_SIGNING_SECRET && env.SLACK_BOT_TOKEN);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-[180px_minmax(0,1fr)] items-start gap-10">
        <nav className="sticky top-7 flex flex-col gap-[2px] text-[13px]">
          {NAV.map(([id, label]) => (
            <a
              key={id} href={`#${id}`}
              className="rounded-md px-[10px] py-[6px] text-neutral-300 no-underline hover:bg-accent-900 hover:text-accent-300"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex max-w-[900px] flex-col gap-8">
          <section id="users" className="scroll-mt-7">
            <UsersSection users={rows} me={session.email} />
          </section>

          <section id="mappings" className="flex scroll-mt-7 flex-col gap-3">
            <div>
              <h2 className="mb-[2px] text-[17px]">Saved column mappings</h2>
              <p className="m-0 text-[13px] text-neutral-400">
                One default per (source, kind). The import wizard loads these and offers to save
                changes back.
              </p>
            </div>
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Source</th><th>Kind</th><th className="num">Columns mapped</th>
                  <th>Last used</th><th />
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={`${m.source}:${m.kind}`}>
                    <td>{m.source}</td>
                    <td>{m.kind}</td>
                    <td className="num">{Object.keys(m.mapping).length}</td>
                    <td className="text-neutral-500">{shortDate(m.updated_at)}</td>
                    <td className="num">
                      <Link
                        className="text-[12px] no-underline"
                        href={`/imports/new?source=${m.source}&kind=${m.kind}`}
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
                {mappings.length === 0 && (
                  <tr>
                    <td className="text-neutral-500" colSpan={5}>
                      None saved yet — the wizard writes one the first time you map a file.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section id="export" className="flex scroll-mt-7 flex-col gap-3">
            <div>
              <h2 className="mb-[2px] text-[17px]">Export</h2>
              <p className="m-0 text-[13px] text-neutral-400">
                Streams CSV from the server. File names carry an ISO timestamp. Also available at{' '}
                <Link href="/export">/export</Link> for bookmarking.
              </p>
            </div>
            <ExportButtons />
          </section>

          <section id="integrations" className="flex scroll-mt-7 flex-col gap-3">
            <div>
              <h2 className="mb-[2px] text-[17px]">Integrations</h2>
              <p className="m-0 text-[13px] text-neutral-400">
                Read from environment variables. Secrets are never displayed.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Integration
                title="Slack bot"
                tone={slackConnected ? 'accent' : 'outline'}
                status={slackConnected ? 'connected' : 'not connected'}
                lines={[
                  'Events URL · /api/slack/events',
                  `Signing secret · ${present(env.SLACK_SIGNING_SECRET)}`,
                  `Bot token · ${present(env.SLACK_BOT_TOKEN)}`,
                  `Private channels · ${env.SLACK_TRACK_PRIVATE_CHANNELS === 'true' ? 'on' : 'off'}`,
                  'Daily sync · 03:00',
                ]}
              />
              <Integration
                title="Tally webhooks"
                tone="outline"
                status="stub"
                lines={[
                  'URL · /api/webhooks/tally',
                  `Signing secret · ${present(env.TALLY_SIGNING_SECRET)}`,
                  'Payloads stored to webhook_inbox',
                  'Form mappings · configured in the import wizard',
                ]}
              />
              <Integration
                title="Luma"
                tone={env.LUMA_API_KEY ? 'accent' : 'neutral'}
                status={env.LUMA_API_KEY ? 'configured' : 'not configured'}
                lines={[
                  `API key · ${present(env.LUMA_API_KEY)}`,
                  'Webhook URL · /api/webhooks/luma',
                  `Webhook secret · ${present(env.LUMA_WEBHOOK_SECRET)}`,
                  'Requires Luma Plus. CSV import works without it.',
                ]}
              />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
