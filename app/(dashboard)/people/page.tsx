import Link from 'next/link';
import { DownloadSimple, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/ui/primitives';
import { parsePeopleQuery, PEOPLE_PAGE } from '@/lib/peopleQuery';
import { gradYears, listPeople, peopleStats } from '@/lib/queries';
import { PeopleTable } from './PeopleTable';

type Params = Record<string, string | string[] | undefined>;

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Params> }) {
  const query = parsePeopleQuery(await searchParams);
  const [{ rows, total }, stats, years] = await Promise.all([
    listPeople(query), peopleStats(), gradYears(),
  ]);

  return (
    <>
      <PageHeader
        title="People"
        subtitle={
          `${(stats?.total_people ?? 0).toLocaleString()} people`
          + ` · ${stats?.members ?? 0} members · ${stats?.in_slack ?? 0} in Slack`
        }
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
      <PeopleTable
        rows={rows} total={total} pages={Math.max(1, Math.ceil(total / PEOPLE_PAGE))}
        query={query} years={years}
      />
    </>
  );
}
