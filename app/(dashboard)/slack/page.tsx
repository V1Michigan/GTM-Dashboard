import Link from 'next/link';
import { ChannelsTable } from './ChannelsTable';
import { PageHeader, StatCard } from '@/components/ui/primitives';
import { overview, slackOverview } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';

export default async function SlackPage() {
  const [{ channels, unmatched, notInSlack }, { stats }] = await Promise.all([
    slackOverview(), overview(),
  ]);

  const joined = channels.filter((c) => c.bot_is_member && !c.is_archived).length;
  const messages30d = channels.reduce((n, c) => n + c.messages_30d, 0);
  const lastSync = channels.map((c) => c.last_synced_at).filter(Boolean).sort().at(-1);
  const withEmail = unmatched.filter((u) => u.email).length;

  return (
    <>
      <PageHeader
        title="Slack"
        subtitle={
          `Public channels only · ${joined} of ${channels.length} joined by the bot`
          + (lastSync ? ` · last sync ${fmtDateTime(lastSync)}` : ' · never synced')
        }
      />

      <div className="mb-5 grid grid-cols-4 gap-3">
        <StatCard label="People in Slack" value={(stats?.in_slack ?? 0).toLocaleString()} />
        <StatCard label="Public channels" value={channels.length} note={`${joined} joined by the bot`} />
        <StatCard label="Messages last 30d" value={messages30d.toLocaleString()} />
        <StatCard
          label="Unmatched Slack users" value={unmatched.length}
          note="Resolve in review →" accent href="/review"
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-6">
        <div className="flex flex-col gap-[10px]">
          <h2 className="text-[14px]">Channels</h2>
          <ChannelsTable channels={channels} />
          <p className="m-0 text-[12px] text-neutral-500">
            Counts are daily aggregates per person and channel. Message text is never received,
            logged or stored.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <section className="card elev-sm gap-[10px] px-[18px] py-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[14px]">Members not in Slack</h2>
              <span className="text-[12px] text-neutral-500">
                {notInSlack.length} of {stats?.members ?? 0}
              </span>
            </div>
            <table className="table table-dense">
              <tbody>
                {notInSlack.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/people/${p.id}`} className="no-underline">
                        {[p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown'}
                      </Link>
                    </td>
                  </tr>
                ))}
                {notInSlack.length === 0 && (
                  <tr><td className="text-neutral-500">Every member is in Slack.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="card elev-sm items-start gap-[10px] px-[18px] py-4">
            <h2 className="text-[14px]">Unmatched Slack users</h2>
            <p className="m-0 text-[13px] text-neutral-400">
              {unmatched.length} Slack account{unmatched.length === 1 ? ' has' : 's have'} no linked
              person. {withEmail} carr{withEmail === 1 ? 'ies' : 'y'} an email address the match
              ladder could not place; the rest are waiting on a review decision.
            </p>
            <Link className="btn btn-primary" href="/review">Open in review</Link>
          </section>
        </div>
      </div>
    </>
  );
}
