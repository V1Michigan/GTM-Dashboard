# Duplicate review rules

Import previews and committed imports use the same matching rule (TypeScript
and `match_person` in the baseline migration). Exact email, Slack ID, and uniqname
matches retain priority. If those identifiers point at different people, the
existing conflict handling requires a human decision.

When no identifier matches, a duplicate suggestion requires:

- The entire name matches after Unicode normalization, lowercasing, removing common punctuation, trimming,
  and collapsing repeated whitespace.
- Both the incoming record and the candidate have a nonblank email.
- The incoming email differs from the candidate's known emails after normal
  email normalization. Existing secondary emails count as known emails too.

Middle names, suffixes, accented letters, and token order remain significant.
Initials and nicknames are not expanded. Trigram similarity and suspected
`umich.edu` spelling mistakes alone do not generate a duplicate suggestion.
All qualifying exact-name candidates are returned; none are automatically
merged. The existing 0.85 score identifies manual review, not an estimated
probability that two people are the same.

Examples:

| Existing | Incoming | Duplicate suggestion |
| --- | --- | --- |
| Nina Kowalski / nkowal@umich.edu | Nina Kowalski / nina@gmail.com | Yes |
| Nina Kowalski / nkowal@umich.edu | Nina Kowalska / nkowal@umich.efu | No |
| John Smith / john@gmail.com | John Smith Jr. / johnjr@gmail.com | No |
| Nina Kowalski / no email | Nina Kowalski / nina@gmail.com | No |

The review queue also has separate reasons for items: conflicting identifiers,
conflicting existing fields, invalid import rows, unmatched Slack users, and
new coffee-chat contacts/member lookups. This change tightens duplicate
suggestions; it does not remove those other workflows.

Run `pnpm test` for preview and fixture checks. After applying migrations to a
local database, run the transactional SQL checks as postgres:

```sh
psql "$LOCAL_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/matching.sql
```

The SQL checks run matching and actual import application as `authenticated`
with admin RLS. Synthetic data is rolled back. Keep `match_person` and
`lib/matching/matchPerson.ts` in sync so preview and commit decisions agree.
