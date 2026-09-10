-- Spec §3.2. This is the SQL side of the ladder; lib/matching/matchPerson.ts is
-- the TS mirror used for dry-run previews and must produce the same answers.

create function normalize_email(p_email text) returns text
language sql immutable as $$
  select case
    when nullif(btrim(coalesce(p_email, '')), '') is null then null
    -- umich addresses have no dots or +tags in the real uniqname; people type them anyway.
    when split_part(lower(btrim(p_email)), '@', 2) = 'umich.edu'
      then replace(split_part(split_part(lower(btrim(p_email)), '@', 1), '+', 1), '.', '') || '@umich.edu'
    else lower(btrim(p_email))
  end
$$;

create function normalize_name(p_name text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g'),
      '(^| )(jr|sr|ii|iii|iv)( |$)', ' ', 'g'),
    ' +', ' ', 'g')), '')
$$;

-- full_name_normalized / email_normalized are maintained here rather than as
-- generated columns: a stored generated column pins the function definition,
-- and both normalizers must stay editable in step with the TS mirror.
create function people_set_name_normalized() returns trigger language plpgsql as $$
begin
  new.full_name_normalized := normalize_name(concat_ws(' ', new.first_name, new.last_name));
  return new;
end $$;
create trigger set_full_name_normalized before insert or update of first_name, last_name
  on people for each row execute function people_set_name_normalized();

create function person_emails_set_normalized() returns trigger language plpgsql as $$
begin
  new.email_normalized := normalize_email(new.email::text);
  return new;
end $$;
create trigger set_email_normalized before insert or update of email
  on person_emails for each row execute function person_emails_set_normalized();

create function person_display(p_id uuid) returns text
language sql stable as $$
  select btrim(concat_ws(' ', p.first_name, p.last_name))
       || coalesce(' <' || (select e.email::text from person_emails e
                             where e.person_id = p.id
                             order by e.is_primary desc, e.created_at limit 1) || '>', '')
  from people p where p.id = p_id
$$;

-- One element of the MatchCandidate[] in lib/types.ts, or [] when p_id is null.
create function match_candidate(p_id uuid, p_confidence numeric, p_reason text) returns jsonb
language sql stable as $$
  select case when p_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
    'person_id', p_id, 'confidence', p_confidence,
    'reason', p_reason, 'display', coalesce(person_display(p_id), ''))) end
$$;

/*
 * Returns (person_id, confidence, candidates).
 *   person_id not null  -> auto-link (confidence is always >= 0.9)
 *   person_id null, candidates = []  -> no candidates, caller creates the person
 *   person_id null, candidates <> [] -> review queue; two candidates at >= 0.9
 *                                       means conflict, which is never auto-merged
 */
create function match_person(
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
  -- uniqname candidate at 0.85, which lands in review. The address is never rewritten.
  if v_email is not null and v_domain <> 'umich.edu' and levenshtein(v_domain, 'umich.edu') <= 2 then
    select p.id into v_typo_id from people p where p.uniqname = v_local::citext;
    if v_typo_id is not null then
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
    if jsonb_array_length(v_cands) > 0 then
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
      ) s;
    if jsonb_array_length(v_cands) > 0 then
      return query select null::uuid, v_conf, v_cands;
      return;
    end if;
  end if;

  return query select null::uuid, 1.0::numeric, '[]'::jsonb;   -- new person
end $$;
