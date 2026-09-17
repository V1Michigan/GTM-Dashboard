# Dashboard load improvements

The dashboard layout authenticates before rendering. The review count now
renders in its own Suspense boundary inside the sidebar, so navigation and page
content do not wait for that count. The admin coffee-chat logger uses the same
badge. The loading fallback is empty; a zero count still produces no badge.

Migration `0023_rls_statement_lookup.sql` wraps the public-table RLS role and
person helpers in scalar subqueries. This allows PostgreSQL InitPlans to reuse
the lookups rather than querying the allowlist for each scanned row. The live
allowlist, member ownership rules, and 24-hour deletion window are unchanged.

## Local benchmark

Measured on PostgreSQL 17 with the application's migrations, minimal local
stand-ins for Supabase's auth/storage platform objects, and synthetic data:
3,000 people, 3,000 emails, 12,000 attendance rows across four events, and 3,000
open review items. Queries run as `authenticated`, not as a service role.
Each number is the median of five measured runs after a warmup.

| Database query | Before | After |
| --- | ---: | ---: |
| Overview statistics | 17.308 ms | 0.624 ms |
| People exact count | 6.379 ms | 0.175 ms |
| People page, 50 enriched rows | 237.394 ms | 176.972 ms |
| Open review count | 6.362 ms | 0.168 ms |

The script also verifies identical query results before and after. These are
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

Use a local database with migrations through at least 0022 and a `postgres`
connection. Apply 0023 before the policy regression test. The benchmark works
before or after 0023: it restores the original policies inside its transaction,
measures them, applies 0023, and measures again. Fixture writes and trial policy
changes roll back. Do not run the benchmark against production.

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

Deploy the application changes and apply migration 0023 to the target Supabase
database through the normal migration process. The UI and SQL changes can be
released independently. No production deployment or database change was made
as part of this local verification.
