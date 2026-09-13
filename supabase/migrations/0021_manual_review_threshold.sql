-- Require at least 0.85 confidence before reviewing a possible duplicate.
-- Weaker matches create new people; exact identifiers still auto-link, and
-- conflicting identifiers still require review.
-- Keep this ladder in sync with lib/matching/matchPerson.ts.

create or replace function match_person(
  p_email text default null,
  p_name text default null,
  p_uniqname text default null,
  p_slack_user_id text default null
) returns table (person_id uuid, confidence numeric, candidates jsonb)
language plpgsql stable as $$
declare
  v_email  text := normalize_email(p_email);
  v_name   text := normalize_name(p_name);
  v_uniq   text := lower(nullif(btrim(p_uniqname), ''));
  v_slack  text := nullif(btrim(p_slack_user_id), '');
  v_domain text := split_part(coalesce(v_email, ''), '@', 2);
  v_local  text := split_part(coalesce(v_email, ''), '@', 1);
  v_slack_id uuid; v_email_id uuid; v_uniq_id uuid; v_typo_id uuid;
  v_ids uuid[];
  v_cands jsonb := '[]'::jsonb;
  v_conf numeric;
  v_review_min constant numeric := 0.85;
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

  -- §4.8 typo domains (umich.efu, umich.com, umich.ed): the local part is a
  -- uniqname candidate at 0.85, meeting the review minimum. The address is never rewritten.
  if v_email is not null and v_domain <> 'umich.edu' and levenshtein(v_domain, 'umich.edu') <= 2 then
    select p.id into v_typo_id from people p where p.uniqname = v_local::citext;
    if v_typo_id is not null and 0.85 >= v_review_min then
      return query select null::uuid, 0.85::numeric,
        match_candidate(v_typo_id, 0.85, 'uniqname_typo_domain');
      return;
    end if;
  end if;

  if v_name is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'person_id', p.id, 'confidence', 0.7,
             'reason', 'name_exact', 'display', person_display(p.id))), '[]'::jsonb)
      into v_cands
      from people p where p.full_name_normalized = v_name;
    if jsonb_array_length(v_cands) > 0 and 0.7 >= v_review_min then
      return query select null::uuid, 0.7::numeric, v_cands;
      return;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'person_id', s.id, 'confidence', s.conf,
             'reason', 'name_similarity', 'display', person_display(s.id))
             order by s.conf desc), '[]'::jsonb), max(s.conf)
      into v_cands, v_conf
      from (
        select p.id, least(round(similarity(p.full_name_normalized, v_name)::numeric, 2), 0.69) as conf
        from people p
        where p.full_name_normalized % v_name
          and similarity(p.full_name_normalized, v_name) >= 0.6
        order by 2 desc limit 5
      ) s where s.conf >= v_review_min;
    if jsonb_array_length(v_cands) > 0 then
      return query select null::uuid, v_conf, v_cands;
      return;
    end if;
  end if;

  return query select null::uuid, 1.0::numeric, '[]'::jsonb;   -- new person
end $$;
