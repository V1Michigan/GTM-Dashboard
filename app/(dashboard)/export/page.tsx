import { DownloadSimple } from '@phosphor-icons/react/dist/ssr';
import { EXPORT_TABLES, PEOPLE_WIDE_COLUMNS, ZIP_HREF, csvHref } from '@/components/ExportButtons';
import { PageHeader } from '@/components/ui/primitives';
import { tags, withCache } from '@/lib/cache';

export default async function ExportPage() {
  const counts = await withCache(
    ['export-counts'],
    [tags.people, tags.events, tags.imports, tags.slack, tags.coffeeChats],
    async (db) => {
      const entries = await Promise.all(EXPORT_TABLES.map(async ({ table }) => {
        const { count } = await db.from(table).select('*', { count: 'exact', head: true });
        return [table, count ?? 0] as const;
      }));
      return Object.fromEntries(entries) as Record<string, number>;
    },
  );

  const people = counts.people ?? 0;
  const events = counts.events ?? 0;

  return (
    <>
      <PageHeader
        title="Export"
        subtitle="Every table as raw CSV with ids, plus one human-readable people_wide.csv. Generated server-side and streamed."
      />

      <div className="mb-[22px] grid max-w-[1000px] grid-cols-2 items-start gap-5">
        <div className="card elev-sm items-start gap-3 px-5 py-[18px] shadow-[inset_0_0_0_1px_var(--color-accent-700)]">
          <span className="card-kicker">Recommended</span>
          <span className="card-title">Everything · all.zip</span>
          <span className="card-body text-neutral-400 opacity-100">
            {EXPORT_TABLES.length} table CSVs plus people_wide.csv. One row per person with joined
            columns and one column per event (registered / attended / both / none).
          </span>
          <span className="font-mono text-[12px] text-neutral-500">
            v1-export-&lt;ISO timestamp&gt;.zip
          </span>
          <a className="btn btn-primary" href={ZIP_HREF} download>
            <DownloadSimple size={16} aria-hidden />Download all.zip
          </a>
        </div>

        <div className="card elev-sm items-start gap-3 px-5 py-[18px]">
          <span className="card-kicker">Human-readable</span>
          <span className="card-title">people_wide.csv</span>
          <span className="card-body text-neutral-400 opacity-100">
            {PEOPLE_WIDE_COLUMNS.join(', ')}, evt_&lt;date&gt;_&lt;slug&gt; …
          </span>
          <span className="text-[12px] text-neutral-500">
            {people.toLocaleString()} rows · {PEOPLE_WIDE_COLUMNS.length + events} columns
          </span>
          <a className="btn btn-secondary" href={csvHref('people_wide')} download>
            Download people_wide.csv
          </a>
        </div>
      </div>

      <div className="flex max-w-[1000px] flex-col gap-[10px]">
        <h2 className="text-[14px]">Individual tables</h2>
        <table className="table table-dense">
          <thead>
            <tr><th>Table</th><th className="num">Rows</th><th>Description</th><th /></tr>
          </thead>
          <tbody>
            {EXPORT_TABLES.map(({ table, description }) => (
              <tr key={table}>
                <td className="font-mono text-[12.5px]">{table}</td>
                <td className="num">{(counts[table] ?? 0).toLocaleString()}</td>
                <td className="text-neutral-400">{description}</td>
                <td className="num">
                  <a className="text-[12px] no-underline" href={csvHref(table)} download>Download CSV</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
