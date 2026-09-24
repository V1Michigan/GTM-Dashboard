# Dashboard load improvements

The dashboard layout authenticates before rendering. The review count now
renders in its own Suspense boundary inside the sidebar, so navigation and page
content do not wait for that count. The admin coffee-chat logger uses the same
badge. The loading fallback is empty; a zero count still produces no badge.

The RLS policies wrap the public-table RLS role and
person helpers in scalar subqueries. This allows PostgreSQL InitPlans to reuse
the lookups rather than querying the allowlist for each scanned row. The live
allowlist, member ownership rules, and 24-hour deletion window are unchanged.

## Local benchmark

Measured on PostgreSQL 17 with the application's migrations, minimal local
stand-ins for Supabase's auth/storage platform objects, and synthetic data:
3,000 people, 3,000 emails, 12,000 attendance rows across four events, and 3,000
open review items. Queries run as `authenticated`, not as a service role.
Each number is the median of five measured runs after a warmup. "Before" is
the earlier direct-call policies; the benchmark script now reports only the
current policies.

| Database query | Before | After |
| --- | ---: | ---: |
| Overview statistics | 17.308 ms | 0.624 ms |
| People exact count | 6.379 ms | 0.175 ms |
| People page, 50 enriched rows | 237.394 ms | 176.972 ms |
| Open review count | 6.362 ms | 0.168 ms |

These are
database execution times, excluding hosting startup, authentication HTTP calls,
cache access, network transfer, and browser rendering. They do not predict
production page-load times. The People view still warrants separate profiling
if it remains slow after these changes.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
psql "$LOCAL_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/rls-statement-lookup.sql
psql "$LOCAL_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/benchmark-rls.sql
```

Use a local migrated database and a `postgres` connection. The benchmark
reports median execution time per list query under authenticated RLS. Fixture
writes roll back. Do not run the benchmark against production.

The SQL regression checks admin reads/writes, member ownership and write
restrictions, anonymous/unlisted access, immediate admin demotion, and an
InitPlan in the authenticated query plan. The React streaming regression holds
the count unresolved and verifies that navigation/page content renders first;
it separately verifies that authentication still gates the layout.

A local `next start` smoke test against a simulated Supabase HTTP endpoint
delayed the review count by 2,000 ms. Navigation streamed at 265 ms, People page
content at 266 ms, and the badge at 2,259 ms. This verifies production-build
streaming behavior under an artificial delay, not real Supabase/network speed.

## Release

The RLS policies ship in the baseline migration; there is no separate release
step.
