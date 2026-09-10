-- Slack's workspace member export as an import kind, so it reuses the whole
-- pipeline: matching, the review queue, idempotent re-uploads and the
-- field_changes audit. Postgres will not let a transaction use an enum label it
-- added, so the branch that consumes this lives in the next migration.
alter type import_kind_t add value 'slack_members';
