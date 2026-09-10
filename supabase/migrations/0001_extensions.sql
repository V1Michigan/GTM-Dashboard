-- Spec §4: pg_trgm (name similarity) and citext (emails/uniqnames).
-- fuzzystrmatch adds levenshtein(), used by the typo-domain rule in §4.8.
--
-- Installed into `public` rather than Supabase's `extensions` schema so that the
-- security-definer functions below can pin `search_path = public, pg_temp` and
-- still resolve similarity()/levenshtein(). A definer function with a mutable
-- search_path is a privilege-escalation hole; this is the trade.
create extension if not exists pg_trgm;
create extension if not exists citext;
create extension if not exists fuzzystrmatch;
