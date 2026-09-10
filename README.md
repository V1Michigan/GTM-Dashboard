# V1 GTM Dashboard

Member and event tracking for the V1 Michigan community team. Implements
`v1-gtm-dashboard-architecture.md` §1–10; §11 is deliberately not built.

## Run it locally

```bash
cp .env.example .env        # fill in SEED_ADMIN_EMAIL at minimum
pnpm install
supabase start              # Postgres + Auth + Storage + Studio, migrations and seed applied
make dev                    # or: pnpm dev
```

`make reset` re-applies every migration and reseeds. `make tunnel` prints a
public URL for the Slack and Tally webhook routes during development.
`DEV_BYPASS_AUTH=true` injects a fixed admin session. It is gated on
`NODE_ENV !== 'production'`, so setting it has no effect under a production
runtime.

## Layout

```
app/(auth)/login          email + password sign-in, and the rejected-account notice
app/(dashboard)           every admin page; middleware 404s the `member` role here
app/api                   imports, export, slack events, webhook stubs
lib/supabase              server (RLS) / browser / service-role clients
lib/matching              normalize + matchPerson, the TS mirror of the SQL ladder
lib/imports               per-kind Zod schemas, the §4.9 column mappings, parsing
lib/queries.ts            the cached read layer — every page renders from here
lib/cache.ts              tag constants + withCache/revalidate
supabase/migrations       the only way the schema changes
netlify/functions         slack-sync, daily
fixtures/csv              one sample file per import kind
```

## Conventions

- **Reads** go through `lib/queries.ts`. Each is wrapped in `withCache(keyParts,
  tags, fn)`; **writes** call `revalidate(...)` with the tags they touched.
  Counts come from SQL views, never from JS.
- **Types** live in `lib/types.ts` and are attached at the query boundary. The
  file mirrors `supabase/migrations`; regenerate with `supabase gen types` if it
  drifts.
- **Server Actions** do mutations. Any write to a `people` or `events` field also
  writes a `field_changes` row — call the SQL helpers rather than duplicating that.
- **The service-role client** is only legal inside `app/api/webhooks/*`,
  `app/api/slack/*`, and `netlify/functions/*`, each of which verifies its own
  signature.

## Design system

Nocturne, copied verbatim to `app/nocturne.css` from the handoff. It is the
canonical token source; `app/globals.css` maps those tokens onto Tailwind v4 so
utilities and component classes resolve to the same values.

**Deviation from spec §5, recorded here as the spec asks.** The spec fixes
Google as the only provider with email/password disabled. This build uses email
+ password instead, at the owner's direction. The access rule is unchanged and
is still enforced where it always was: the `auth.users` trigger in migration
0012 refuses any address that is not `@umich.edu` **and** either on `app_users`
or attached to a person with `is_v1_member = true`. Switching provider does not
widen who can get in. Email confirmations are off, so no SMTP is required.

**One deviation from spec §2, recorded here as the spec asks.** The spec names
shadcn/ui. Nocturne already ships `.btn`, `.card`, `.table`, `.tag`, `.input`,
`.seg` and `.dialog` as finished CSS, so generating shadcn's components and then
re-theming each one against those same variables would be strictly more code for
identical pixels. Instead `components/ui/` wraps Radix primitives — the parts
that carry real behaviour and accessibility (dialog, popover, combobox, radio
group, checkbox) — in the Nocturne classes, and everything purely visual uses the
classes directly. TanStack Table, Tailwind and the token mapping are unchanged.
