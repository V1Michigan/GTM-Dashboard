/**
 * PostgREST caps an unbounded `select()` at 1000 rows and says nothing about it,
 * so a table that grows past 1000 starts silently losing rows — a truncated
 * people table, a matcher that cannot see half the database, a short export.
 * Page through with `.range()` instead.
 *
 * Every paged query needs a deterministic `.order()`; without one, Postgres may
 * return rows in a different order per page, which both repeats and skips rows.
 */
const PAGE = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) return out;
  }
}
