-- Duplicate review is an explicit rule: exact full name, different present
-- emails. Similar spellings and suspected email-domain typos are not sufficient.
-- Exact email/Slack/uniqname identifiers and identifier conflicts keep priority.
-- Keep the rule in sync with lib/matching/matchPerson.ts.

-- Unlike the general search normalizer, retain suffixes and Unicode letters.
-- Ignore common punctuation and repeated whitespace; never expand initials or
-- nicknames. NFC preserves canonical accents; translate preserves combining
-- marks that cannot be composed, unlike a broad non-letter regex.
create function normalize_match_name(p_name text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(
    translate(lower(normalize(coalesce(p_name, ''), NFC)),
      $punct$!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~‐‑‒–—―‘’‚‛“”„‟$punct$, ''),
    -- The same whitespace set as JavaScript's \s, including nonbreaking spaces.
    U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')), '')
$$;

create index people_exact_match_name on people (
  normalize_match_name(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
);

create or replace function match_person(
  p_email text default null,
  p_name text default null,
  p_uniqname text default null,
  p_slack_user_id text default null
) returns table (person_id uuid, confidence numeric, candidates jsonb)
language plpgsql stable as $$
declare
  v_email  text := normalize_email(p_email);
  v_name   text := normalize_match_name(p_name);
  v_uniq   text := lower(nullif(btrim(p_uniqname), ''));
  v_slack  text := nullif(btrim(p_slack_user_id), '');
  v_domain text := split_part(coalesce(v_email, ''), '@', 2);
  v_local  text := split_part(coalesce(v_email, ''), '@', 1);
  v_slack_id uuid; v_email_id uuid; v_uniq_id uuid;
  v_ids uuid[];
  v_cands jsonb := '[]'::jsonb;
begin
  if v_uniq is null and v_domain = 'umich.edu' then
    v_uniq := v_local;
  end if;

  if v_slack is not null then
    select p.id into v_slack_id from people p where p.slack_user_id = v_slack;
  end if;
  if v_email is not null then
    select pe.person_id into v_email_id from person_emails pe where pe.email_normalized = v_email;
  end if;
  if v_uniq is not null then
    -- explicit ::citext: citext = text would resolve to the case-sensitive text operator
    select p.id into v_uniq_id from people p where p.uniqname = v_uniq::citext;
  end if;

  v_cands := match_candidate(v_slack_id, 1.0, 'slack_user_id')
          || match_candidate(v_email_id, 1.0, 'email')
          || match_candidate(v_uniq_id, 0.95, 'uniqname');
  select array_agg(distinct x) into v_ids
    from unnest(array[v_slack_id, v_email_id, v_uniq_id]) x where x is not null;

  if coalesce(array_length(v_ids, 1), 0) > 1 then
    return query select null::uuid, 1.0::numeric, v_cands;   -- conflict
    return;
  elsif coalesce(array_length(v_ids, 1), 0) = 1 then
    return query select v_ids[1],
      case when v_slack_id is not null or v_email_id is not null then 1.0 else 0.95 end::numeric,
      v_cands;
    return;
  end if;

  if v_email is not null and v_name is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'person_id', p.id, 'confidence', 0.85,
      'reason', 'name_exact_email_different', 'display', person_display(p.id))
      order by p.id), '[]'::jsonb)
    into v_cands
    from people p
    where normalize_match_name(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) = v_name
      and exists (
        select 1 from person_emails pe
        where pe.person_id = p.id and nullif(btrim(pe.email_normalized), '') is not null
          and pe.email_normalized <> v_email
      );
    if jsonb_array_length(v_cands) > 0 then
      return query select null::uuid, 0.85::numeric, v_cands;
      return;
    end if;
  end if;

  return query select null::uuid, 1.0::numeric, '[]'::jsonb;
end $$;
