import Link from 'next/link';
import { DownloadSimple, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/ui/primitives';
import { listPeople } from '@/lib/queries';
import { PeopleTable } from './PeopleTable';

export default async function PeoplePage() {
  const people = await listPeople();
  const members = people.filter((p) => p.is_v1_member).length;
  const inSlack = people.filter((p) => p.slack_joined_at !== null).length;

  return (
    <>
      <PageHeader
        title="People"
        subtitle={`${people.length.toLocaleString()} people · ${members} members · ${inSlack} in Slack`}
        actions={
          <>
            <a className="btn btn-secondary" href="/api/export/people_wide.csv">
              <DownloadSimple size={16} /> Export people_wide.csv
            </a>
            <Link className="btn btn-primary" href="/imports/new?kind=people_bulk">
              <UploadSimple size={16} /> Upload CSV
            </Link>
          </>
        }
      />
      <PeopleTable rows={people} />
    </>
  );
}
