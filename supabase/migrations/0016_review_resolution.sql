-- Two review-queue defects, both in apply_import_row/apply_import:
--   1. resolving an item as "create a new person" re-ran the match ladder, hit
--      the same ambiguity and raised a replacement item, so the row appeared to
--      move to the bottom of the queue instead of leaving it.
--   2. rows the dry run staged as `review` were skipped by the commit loop, so
--      they never got a review_items row and could not be resolved at all.
-- The signature gains a parameter, so the old function is dropped first.
drop function if exists apply_import_row(uuid, boolean);

create function apply_import_row(
  p_import_row_id uuid,
  p_incoming_wins boolean default false,
  p_force_create boolean default false
)
returns text language plpgsql as $$
declare
  v_row import_rows; v_imp imports; v_p jsonb; v_match record;
  v_email text; v_name text; v_first text; v_last text; v_uniq text;
  v_person uuid; v_member uuid; v_created boolean := false; v_existed boolean := false;
begin
  select ir.* into v_row from import_rows ir where ir.id = p_import_row_id;
  if not found then raise exception 'import_row % not found', p_import_row_id; end if;
  select i.* into v_imp from imports i where i.id = v_row.import_id;

  v_p := coalesce(v_row.parsed, map_row(v_row.raw, v_imp.column_mapping));
  if v_row.parsed is null then
    update import_rows set parsed = v_p where id = v_row.id;
  end if;

  -- rule 1: an identical row already applied for the same (kind, event) is a no-op
  if exists (
    select 1 from import_rows ir join imports i on i.id = ir.import_id
    where ir.row_hash = v_row.row_hash and ir.id <> v_row.id and ir.status = 'applied'
      and i.kind = v_imp.kind and i.event_id is not distinct from v_imp.event_id
  ) then
    update import_rows set status = 'skipped_unchanged', error = null where id = v_row.id;
    return 'unchanged';
  end if;

  v_email := nullif(btrim(v_p ->> 'email'), '');
  v_name  := nullif(btrim(v_p ->> 'name'), '');
  v_first := coalesce(nullif(btrim(v_p ->> 'first_name'), ''),
                      nullif(substring(v_name from '^(.*) \S+$'), ''), v_name);
  v_last  := coalesce(nullif(btrim(v_p ->> 'last_name'), ''),
                      nullif(substring(v_name from ' (\S+)$'), ''));
  v_name  := coalesce(v_name, concat_ws(' ', v_first, v_last));
  v_uniq  := coalesce(nullif(btrim(v_p ->> 'uniqname'), ''),
                      case when split_part(coalesce(normalize_email(v_email), ''), '@', 2) = 'umich.edu'
                           then split_part(normalize_email(v_email), '@', 1) end);

  -- §8.4 syncs only non-bot, non-deleted users, and this is the CSV equivalent.
  -- Checked before matching so no person row is ever created for a bot.
  if v_imp.kind = 'slack_members' and (
       lower(coalesce(v_p ->> 'slack_status', '')) in ('bot', 'deactivated')
       or split_part(lower(coalesce(v_email, '')), '@', 2) = 'slack-bots.com') then
    update import_rows set status = 'skipped_unchanged', error = null where id = v_row.id;
    return 'unchanged';
  end if;

  -- §4.8 test rows. The wizard's "import anyway" toggle is imports.allow_bad_rows;
  -- a row whose person_id a human already chose in /review is past this check.
  if not v_imp.allow_bad_rows and v_row.person_id is null and (
       split_part(lower(coalesce(v_email, '')), '@', 2) ~ '^test\.'
       or lower(split_part(coalesce(v_email, ''), '@', 1)) = 'test'
       or normalize_name(v_name) = 'test') then
    insert into review_items (kind, import_row_id, payload) values ('bad_row', v_row.id, v_p);
    update import_rows set status = 'review' where id = v_row.id;
    return 'review';
  end if;

  -- rule 2
  v_person := v_row.person_id;
  -- A human resolving a review item as "create a new person" has already made
  -- the decision the ladder would re-litigate. Without this the resolver re-runs
  -- match_person, hits the same ambiguity, and raises a fresh review item — the
  -- resolved row reappears at the bottom of the queue instead of leaving it.
  if v_person is null and p_force_create then
    insert into people default values returning id into v_person;
    v_created := true;
  elsif v_person is null then
    select * into v_match
      from match_person(v_email, v_name, v_uniq, nullif(v_p ->> 'slack_user_id', ''));
    if v_match.person_id is not null then
      v_person := v_match.person_id;
    elsif jsonb_array_length(v_match.candidates) = 0 then
      insert into people default values returning id into v_person;
      v_created := true;
    else
      -- Re-running a row that is already queued must not queue it twice.
      insert into review_items (kind, import_row_id, payload, candidates)
      select
        case when (select count(*) from jsonb_array_elements(v_match.candidates) c
                    where (c ->> 'confidence')::numeric >= 0.9) > 1
             then 'conflict'::review_kind_t else 'ambiguous_match'::review_kind_t end,
        v_row.id, v_p, v_match.candidates
      where not exists (
        select 1 from review_items rv
        where rv.import_row_id = v_row.id and rv.status = 'open');
      update import_rows set status = 'review', match_confidence = v_match.confidence
       where id = v_row.id;
      return 'review';
    end if;
  end if;

  -- rule 5: every email seen for a matched person is kept, non-primary unless it is the first
  if v_email is not null then
    insert into person_emails (person_id, email, is_primary, source)
    values (v_person, v_email::citext,
            not exists (select 1 from person_emails pe where pe.person_id = v_person and pe.is_primary),
            v_imp.source)
    on conflict (email_normalized) do nothing;
  end if;

  -- rule 4
  perform apply_person_fields(v_person, jsonb_strip_nulls(jsonb_build_object(
    'first_name', v_first, 'last_name', v_last, 'uniqname', v_uniq,
    'grad_year', v_p ->> 'grad_year', 'grad_term', v_p ->> 'grad_term',
    'student_level', v_p ->> 'student_level', 'major', v_p ->> 'major',
    'gender', v_p ->> 'gender'
  )), v_imp.id, v_row.id, p_incoming_wins, v_imp.source);

  -- rule 3: the target row for this import kind
  if v_imp.kind in ('event_registration', 'event_checkin') and v_imp.event_id is null then
    raise exception 'import % is % but has no event_id', v_imp.id, v_imp.kind;
  end if;
  select exists (select 1 from event_attendance a
                  where a.event_id = v_imp.event_id and a.person_id = v_person) into v_existed;

  if v_imp.kind = 'event_registration' then
    insert into event_attendance (
      event_id, person_id, registered, registered_at, registration_source,
      luma_approval_status, luma_guest_id, referral_source, utm_source, referred_by_email,
      first_import_id, last_import_id)
    values (
      v_imp.event_id, v_person, coalesce((v_p ->> 'registered')::boolean, true),
      nullif(v_p ->> 'registered_at', '')::timestamptz, v_imp.source,
      nullif(v_p ->> 'luma_approval_status', ''), nullif(v_p ->> 'luma_guest_id', ''),
      nullif(v_p ->> 'referral_source', ''), nullif(v_p ->> 'utm_source', ''),
      nullif(v_p ->> 'referred_by_email', '')::citext, v_imp.id, v_imp.id)
    on conflict (event_id, person_id) do update set
      -- incoming wins so a later "declined" can un-register; §4.9 maps approval_status
      registered           = excluded.registered,
      registered_at        = coalesce(event_attendance.registered_at, excluded.registered_at),
      registration_source  = excluded.registration_source,
      luma_approval_status = coalesce(excluded.luma_approval_status, event_attendance.luma_approval_status),
      luma_guest_id        = coalesce(excluded.luma_guest_id, event_attendance.luma_guest_id),
      referral_source      = coalesce(event_attendance.referral_source, excluded.referral_source),
      utm_source           = coalesce(event_attendance.utm_source, excluded.utm_source),
      referred_by_email    = coalesce(event_attendance.referred_by_email, excluded.referred_by_email),
      first_import_id      = coalesce(event_attendance.first_import_id, excluded.first_import_id),
      last_import_id       = excluded.last_import_id;
      -- checked_in is never written by a registration import

  elsif v_imp.kind = 'event_checkin' then
    insert into event_attendance (
      event_id, person_id, registered, checked_in, checked_in_at, checkin_source,
      checkin_answers, referral_source, first_import_id, last_import_id)
    values (
      v_imp.event_id, v_person, false, true,
      nullif(v_p ->> 'checked_in_at', '')::timestamptz, v_imp.source,
      coalesce(v_p -> 'checkin_answers', '{}'::jsonb), nullif(v_p ->> 'referral_source', ''),
      v_imp.id, v_imp.id)
    on conflict (event_id, person_id) do update set
      checked_in      = true,
      checked_in_at   = coalesce(event_attendance.checked_in_at, excluded.checked_in_at),
      checkin_source  = excluded.checkin_source,
      checkin_answers = event_attendance.checkin_answers || excluded.checkin_answers,
      referral_source = coalesce(event_attendance.referral_source, excluded.referral_source),
      first_import_id = coalesce(event_attendance.first_import_id, excluded.first_import_id),
      last_import_id  = excluded.last_import_id;

  elsif v_imp.kind in ('interest_form', 'community_interest_form') then
    select exists (select 1 from form_submissions f
                    where f.tally_submission_id = nullif(v_p ->> 'tally_submission_id', ''))
      into v_existed;
    insert into form_submissions (
      person_id, form_kind, tally_form_id, tally_submission_id, submitted_at, answers, import_id)
    values (
      v_person, v_imp.kind, nullif(v_p ->> 'tally_form_id', ''),
      nullif(v_p ->> 'tally_submission_id', ''),
      coalesce(nullif(v_p ->> 'submitted_at', '')::timestamptz, now()),
      coalesce(v_p -> 'answers', '{}'::jsonb), v_imp.id)
    on conflict (tally_submission_id) do nothing;

  elsif v_imp.kind = 'product_studio_application' then
    select exists (select 1 from product_studio_applications a
                    where a.person_id = v_person
                      and a.semester = coalesce((nullif(v_p ->> 'semester', ''))::semester_t, v_imp.semester)
                      and a.year = coalesce((nullif(v_p ->> 'year', ''))::int, v_imp.year))
      into v_existed;
    insert into product_studio_applications (
      person_id, semester, year, round_reached, outcome_notes,
      tally_submission_id, submitted_at, import_id)
    values (
      v_person,
      coalesce((nullif(v_p ->> 'semester', ''))::semester_t, v_imp.semester),
      coalesce((nullif(v_p ->> 'year', ''))::int, v_imp.year),
      coalesce((nullif(v_p ->> 'round_reached', ''))::ps_round_t, 'applied'),
      nullif(v_p ->> 'outcome_notes', ''), nullif(v_p ->> 'tally_submission_id', ''),
      nullif(v_p ->> 'submitted_at', '')::timestamptz, v_imp.id)
    on conflict (person_id, semester, year) do update set
      -- enum declaration order is the round order; it only moves forward unless
      -- the wizard's "incoming values win" was checked (spec's allow_regress flag)
      round_reached = case when v_imp.incoming_wins then excluded.round_reached
                           else greatest(product_studio_applications.round_reached, excluded.round_reached) end,
      outcome_notes = coalesce(excluded.outcome_notes, product_studio_applications.outcome_notes),
      submitted_at  = coalesce(product_studio_applications.submitted_at, excluded.submitted_at),
      import_id     = excluded.import_id;

  elsif v_imp.kind = 'coffee_chat' then
    select m.person_id into v_member
      from match_person(nullif(v_p ->> 'member_email', ''), nullif(v_p ->> 'member_name', '')) m;
    if v_member is null then
      insert into review_items (kind, import_row_id, payload)
      values ('no_match', v_row.id, jsonb_build_object('member_lookup', v_p));
      update import_rows set status = 'review' where id = v_row.id;
      return 'review';
    end if;
    select exists (select 1 from coffee_chats c
                    where c.person_id = v_person and c.member_id = v_member
                      and c.chatted_on is not distinct from nullif(v_p ->> 'chatted_on', '')::date)
      into v_existed;
    insert into coffee_chats (person_id, member_id, chatted_on, notes, source, tally_submission_id)
    values (v_person, v_member, nullif(v_p ->> 'chatted_on', '')::date,
            nullif(v_p ->> 'notes', ''), v_imp.source, nullif(v_p ->> 'tally_submission_id', ''))
    on conflict (person_id, member_id, chatted_on) do nothing;

  elsif v_imp.kind = 'slack_members' then
    -- The export carries no join date, so slack_joined_at records "first seen in
    -- a Slack sync" and is never overwritten once set. slack_user_id likewise
    -- only fills a blank: a person already linked to a different Slack account
    -- is a conflict for a human, not something to silently repoint.
    v_existed := (select p.slack_user_id is not null from people p where p.id = v_person);
    update people p set
      slack_user_id   = coalesce(p.slack_user_id, nullif(v_p ->> 'slack_user_id', '')),
      slack_joined_at = coalesce(p.slack_joined_at, now())
    where p.id = v_person;

    if not v_existed then
      insert into field_changes (table_name, row_id, field, old_value, new_value, source, import_id)
      values ('people', v_person, 'slack_user_id', 'null'::jsonb,
              to_jsonb(v_p ->> 'slack_user_id'), v_imp.source, v_imp.id);
    end if;
    v_existed := not v_created;

  elsif v_imp.kind = 'members_list' then
    -- member_since is coalesce(existing, incoming, import date) rather than a
    -- field_conflict: on a roster the existing date is the authority (§4.8).
    v_existed := (select p.is_v1_member from people p where p.id = v_person);
    update people p set
      is_v1_member = true,
      member_since = coalesce(p.member_since, nullif(v_p ->> 'member_since', '')::date, v_imp.created_at::date)
    where p.id = v_person and (not p.is_v1_member or p.member_since is null);
    if not v_existed then
      insert into field_changes (table_name, row_id, field, old_value, new_value, source, import_id)
      values ('people', v_person, 'is_v1_member', 'false'::jsonb, 'true'::jsonb, v_imp.source, v_imp.id);
    end if;
    v_existed := not v_created;
  else
    v_existed := not v_created;      -- people_bulk: the person row is the target
  end if;

  update import_rows set status = 'applied', person_id = v_person, error = null,
    match_confidence = coalesce(match_confidence, case when v_created then 1.0 else null end)
  where id = v_row.id;

  -- rule 6: nothing is ever deleted by an import
  return case when v_created or not v_existed then 'new' else 'updated' end;
end $$;

-- One transaction per import (the caller's). Row-level failures are recorded on
-- the row and do not abort the rest (§4.8).
create or replace function apply_import(p_import_id uuid) returns void
language plpgsql as $$
declare
  v_imp imports; r record; v_res text; v_new int := 0; v_upd int := 0;
begin
  select i.* into v_imp from imports i where i.id = p_import_id for update;
  if not found then raise exception 'import % not found', p_import_id; end if;

  for r in
    select ir.id from import_rows ir
    -- 'review' included on purpose: the dry run stages a row it could not match
    -- with that status, and if the commit skipped those they would never get a
    -- review_items row and would be invisible in /review forever.
    where ir.import_id = p_import_id and ir.status in ('pending', 'review')
    -- §4.8: duplicates of one person inside one import go oldest-first so the
    -- later row fills fields instead of conflicting. Ordered as text on purpose:
    -- a bad timestamp in one row must not abort the whole import.
    order by nullif(ir.parsed ->> 'submitted_at', '') nulls first, ir.row_index
  loop
    begin
      v_res := apply_import_row(r.id, v_imp.incoming_wins);
      if v_res = 'new' then v_new := v_new + 1;
      elsif v_res = 'updated' then v_upd := v_upd + 1;
      end if;
    exception when others then
      update import_rows set status = 'failed', error = sqlerrm where id = r.id;
    end;
  end loop;

  if v_imp.kind = 'members_list' and v_imp.replace_roster then
    -- Absence is meaningful only on a roster. Unmark; never delete.
    with dropped as (
      update people p set is_v1_member = false
      where p.is_v1_member
        and not exists (select 1 from import_rows ir
                        where ir.import_id = p_import_id and ir.person_id = p.id)
      returning p.id
    )
    insert into field_changes (table_name, row_id, field, old_value, new_value, source, import_id)
    select 'people', d.id, 'is_v1_member', 'true'::jsonb, 'false'::jsonb, v_imp.source, v_imp.id
    from dropped d;
  end if;

  update imports i set
    row_count      = (select count(*) from import_rows ir where ir.import_id = p_import_id),
    rows_new       = v_new,
    rows_updated   = v_upd,
    rows_unchanged = (select count(*) from import_rows ir where ir.import_id = p_import_id and ir.status = 'skipped_unchanged'),
    rows_review    = (select count(*) from import_rows ir where ir.import_id = p_import_id and ir.status = 'review'),
    rows_failed    = (select count(*) from import_rows ir where ir.import_id = p_import_id and ir.status = 'failed'),
    status = case when exists (
                    select 1 from review_items rv join import_rows ir on ir.id = rv.import_row_id
                    where ir.import_id = p_import_id and rv.status = 'open')
                  then 'needs_review'::import_status_t else 'committed'::import_status_t end,
    committed_at = now()
  where i.id = p_import_id;
end $$;
