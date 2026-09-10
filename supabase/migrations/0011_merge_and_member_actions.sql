/*
 * Spec §3.3. Reassigns every FK from drop_id to keep_id, unions the emails,
 * keeps non-null values from keep and fills its nulls from drop, writes a full
 * snapshot to person_merges, then deletes drop. One transaction (the caller's).
 *
 * The unique constraints ((event_id, person_id) and friends) are handled with a
 * `not exists` guard, the UPDATE equivalent of ON CONFLICT DO NOTHING: the losing
 * duplicate stays on drop_id and disappears with the cascading delete.
 */
create function merge_people(keep_id uuid, drop_id uuid) returns void
language plpgsql as $$
declare v_drop people;
begin
  if keep_id = drop_id then raise exception 'cannot merge a person into itself'; end if;
  select p.* into v_drop from people p where p.id = drop_id;
  if not found then raise exception 'person % not found', drop_id; end if;
  if not exists (select 1 from people p where p.id = keep_id) then
    raise exception 'person % not found', keep_id;
  end if;

  insert into person_merges (kept_id, dropped_id, dropped_snapshot, merged_by)
  values (keep_id, drop_id,
    jsonb_build_object(
      'person', to_jsonb(v_drop),
      'emails', coalesce((select jsonb_agg(to_jsonb(e)) from person_emails e where e.person_id = drop_id), '[]'::jsonb)),
    auth.uid());

  -- keep's primary email stays primary
  update person_emails set person_id = keep_id, is_primary = false where person_id = drop_id;
  update person_emails e set is_primary = true
   where e.person_id = keep_id
     and not exists (select 1 from person_emails x where x.person_id = keep_id and x.is_primary)
     and e.id = (select x.id from person_emails x where x.person_id = keep_id order by x.created_at limit 1);

  update person_organizations o set person_id = keep_id where o.person_id = drop_id
    and not exists (select 1 from person_organizations x
                    where x.person_id = keep_id and x.organization = o.organization);
  update event_attendance a set person_id = keep_id where a.person_id = drop_id
    and not exists (select 1 from event_attendance x
                    where x.person_id = keep_id and x.event_id = a.event_id);
  update product_studio_applications s set person_id = keep_id where s.person_id = drop_id
    and not exists (select 1 from product_studio_applications x
                    where x.person_id = keep_id and x.semester = s.semester and x.year = s.year);
  update coffee_chats c set person_id = keep_id where c.person_id = drop_id
    and not exists (select 1 from coffee_chats x where x.person_id = keep_id
                      and x.member_id = c.member_id and x.chatted_on is not distinct from c.chatted_on);
  update coffee_chats c set member_id = keep_id where c.member_id = drop_id
    and not exists (select 1 from coffee_chats x where x.member_id = keep_id
                      and x.person_id = c.person_id and x.chatted_on is not distinct from c.chatted_on);
  -- counts are additive, so the duplicate day is summed rather than dropped
  insert into slack_channel_activity (person_id, channel_id, activity_date, message_count)
  select keep_id, a.channel_id, a.activity_date, a.message_count
    from slack_channel_activity a where a.person_id = drop_id
  on conflict (person_id, channel_id, activity_date)
    do update set message_count = slack_channel_activity.message_count + excluded.message_count;

  update form_submissions set person_id = keep_id where person_id = drop_id;
  update import_rows     set person_id = keep_id where person_id = drop_id;
  update app_users       set person_id = keep_id where person_id = drop_id;
  update field_changes   set row_id    = keep_id where row_id = drop_id and table_name = 'people';

  delete from people where id = drop_id;   -- cascades the losing duplicates

  -- after the delete: uniqname and slack_user_id are unique
  update people p set
    first_name      = coalesce(p.first_name, v_drop.first_name),
    last_name       = coalesce(p.last_name, v_drop.last_name),
    uniqname        = coalesce(p.uniqname, v_drop.uniqname),
    grad_year       = coalesce(p.grad_year, v_drop.grad_year),
    grad_term       = coalesce(p.grad_term, v_drop.grad_term),
    student_level   = coalesce(p.student_level, v_drop.student_level),
    major           = coalesce(p.major, v_drop.major),
    gender          = coalesce(p.gender, v_drop.gender),
    is_v1_member    = p.is_v1_member or v_drop.is_v1_member,
    member_since    = least(p.member_since, v_drop.member_since),
    slack_user_id   = coalesce(p.slack_user_id, v_drop.slack_user_id),
    slack_joined_at = coalesce(p.slack_joined_at, v_drop.slack_joined_at),
    notes           = coalesce(p.notes, v_drop.notes)
  where p.id = keep_id;
end $$;

/*
 * Spec §4.7. The only write path a `member` has. Security definer because
 * members have no insert policy on people; execute is granted to authenticated
 * only (0012), and authenticated already means allowlisted by the auth trigger.
 */
create function member_log_coffee_chat(
  person_email text, person_name text, chatted_on date default null, notes text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member uuid := current_person_id();
  v_match record; v_person uuid; v_chat uuid;
begin
  if v_member is null then
    raise exception 'no V1 person record is linked to this account';
  end if;
  if nullif(btrim(coalesce(person_email, '')), '') is null then
    raise exception 'an email is required';
  end if;

  select * into v_match from match_person(person_email, person_name);
  v_person := v_match.person_id;
  if v_person is null then
    insert into people (first_name, last_name) values (
      coalesce(nullif(substring(person_name from '^(.*) \S+$'), ''), nullif(btrim(person_name), '')),
      nullif(substring(person_name from ' (\S+)$'), ''))
    returning id into v_person;
    insert into person_emails (person_id, email, is_primary, source)
    values (v_person, person_email::citext, true, 'manual')
    on conflict (email_normalized) do nothing;
    -- an admin confirms (or merges) the person this created
    insert into review_items (kind, payload, candidates)
    values ('no_match', jsonb_build_object(
      'created_person_id', v_person, 'email', person_email, 'name', person_name,
      'logged_by_member_id', v_member, 'source', 'member_log_coffee_chat'), v_match.candidates);
  end if;

  insert into coffee_chats (person_id, member_id, chatted_on, notes, source, logged_by)
  values (v_person, v_member, coalesce(chatted_on, current_date), nullif(btrim(coalesce(notes, '')), ''),
          'manual', auth.uid())
  on conflict (person_id, member_id, chatted_on) do update set notes = coalesce(excluded.notes, coffee_chats.notes)
  returning id into v_chat;
  return v_chat;
end $$;

/*
 * What /review calls. Actions: 'link' (p_person_id), 'create', 'dismiss', and
 * 'accept' for field_conflict items. Merging two candidates is merge_people().
 */
create function resolve_review_item(
  p_item_id uuid, p_action text, p_person_id uuid default null
) returns void language plpgsql as $$
declare
  v_item review_items; v_person uuid := p_person_id;
  v_row import_rows; v_imp imports; v_wins boolean;
begin
  select r.* into v_item from review_items r where r.id = p_item_id;
  if not found then raise exception 'review item % not found', p_item_id; end if;

  if p_action = 'dismiss' then
    update review_items set status = 'dismissed', resolved_by = auth.uid(), resolved_at = now(),
      resolution = jsonb_build_object('action', 'dismiss') where id = p_item_id;
    return;
  end if;

  if v_item.kind = 'field_conflict' and p_action = 'accept' then
    select ir.* into v_row from import_rows ir where ir.id = v_item.import_row_id;
    select i.* into v_imp from imports i where i.id = v_row.import_id;
    perform apply_person_fields(
      (v_item.payload ->> 'person_id')::uuid,
      jsonb_build_object(v_item.payload ->> 'field', v_item.payload -> 'incoming'),
      v_imp.id, v_row.id, true, v_imp.source);
  else
    if p_action = 'create' then
      insert into people default values returning id into v_person;
    elsif v_person is null then
      raise exception 'action % needs a person_id', p_action;
    end if;

    if v_item.import_row_id is not null then
      update import_rows set person_id = v_person, status = 'pending' where id = v_item.import_row_id;
      select i.incoming_wins into v_wins from imports i
        join import_rows ir on ir.import_id = i.id where ir.id = v_item.import_row_id;
      perform apply_import_row(v_item.import_row_id, coalesce(v_wins, false));
    end if;

    if v_item.slack_user_id is not null then
      update people set slack_user_id = v_item.slack_user_id,
                        slack_joined_at = coalesce(slack_joined_at, now())
       where id = v_person;
      -- §8.3: counts buffered while the Slack user was unmatched
      insert into slack_channel_activity (person_id, channel_id, activity_date, message_count)
      select v_person, ch.key, d.key::date, (d.value #>> '{}')::int
        from slack_unmatched_users u,
             jsonb_each(u.pending_message_counts) ch,
             jsonb_each(ch.value) d
       where u.slack_user_id = v_item.slack_user_id
         and exists (select 1 from slack_channels c where c.id = ch.key)
      on conflict (person_id, channel_id, activity_date)
        do update set message_count = slack_channel_activity.message_count + excluded.message_count;
      delete from slack_unmatched_users where slack_user_id = v_item.slack_user_id;
    end if;
  end if;

  update review_items set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
    resolution = jsonb_build_object('action', p_action, 'person_id', v_person)
  where id = p_item_id;
end $$;
