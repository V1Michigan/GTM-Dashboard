/*
 * One review decision in one round trip. /review used to make four or more
 * sequential calls per click (read item, update row, apply, mark resolved), each
 * a network hop from the host to Supabase. Doing it here also makes a decision
 * atomic: a failure part-way no longer leaves a row applied but still open.
 *
 * Actions: link (p_person_id), create, merge (p_person_id keeps, p_drop_id goes),
 * dismiss, field_keep, field_use. Returns the person the item resolved to.
 * SECURITY DEFINER with the same admin guard as apply_import, so RLS is checked
 * once here instead of on every statement.
 */
create function resolve_review_item(
  p_item_id uuid, p_action text, p_person_id uuid default null, p_drop_id uuid default null
) returns uuid language plpgsql security definer
 set search_path = public, pg_temp as $$
declare
  v_item review_items;
  v_target uuid := p_person_id;
  v_full text;
begin
  -- Same guard and reasoning as apply_import.
  if not coalesce(
    public.current_app_role()::text = 'admin'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
       = 'service_role'
    or session_user in ('postgres', 'supabase_admin')
  , false) then
    raise exception 'review decisions are restricted to admins';
  end if;

  if p_action not in ('link', 'create', 'merge', 'dismiss', 'field_keep', 'field_use') then
    raise exception 'Invalid resolution.';
  end if;
  select r.* into v_item from review_items r where r.id = p_item_id for update;
  if not found then raise exception 'Review item not found.'; end if;

  if p_action not in ('dismiss', 'field_keep') then
    if p_action = 'merge' then
      if v_target is null or p_drop_id is null then raise exception 'Merge needs two people.'; end if;
      perform merge_people(v_target, p_drop_id);
    end if;

    if v_item.import_row_id is not null then
      -- A null person_id tells apply_import_row to create the person exactly as
      -- a fresh import would; p_force_create stops the ladder from re-running
      -- and queueing a replacement item for the ambiguity just decided.
      update import_rows set person_id = case when p_action = 'create' then null else v_target end,
                             status = 'pending', error = null
       where id = v_item.import_row_id;
      perform apply_import_row(v_item.import_row_id, p_action = 'field_use', p_action = 'create');
      select person_id into v_target from import_rows where id = v_item.import_row_id;

    elsif v_item.slack_user_id is not null then
      if p_action = 'create' then
        v_full := btrim(coalesce(nullif(v_item.payload ->> 'real_name', ''),
                                 nullif(v_item.payload ->> 'display_name', ''), ''));
        insert into people (first_name, last_name)
        values (nullif(regexp_replace(v_full, '\s*\S+$', ''), ''),
                nullif(substring(v_full from '\S+$'), ''))
        returning id into v_target;
        -- a one-word name is a first name, not a last name
        update people set first_name = last_name, last_name = null
         where id = v_target and first_name is null;
      end if;
      if v_target is null then raise exception 'Pick a person to link.'; end if;

      update people set slack_user_id = v_item.slack_user_id,
             slack_joined_at = coalesce(slack_joined_at,
                                        (v_item.payload ->> 'joined_at')::timestamptz, now())
       where id = v_target;
      if nullif(btrim(v_item.payload ->> 'email'), '') is not null then
        insert into person_emails (person_id, email, source)
        values (v_target, v_item.payload ->> 'email', 'slack')
        on conflict (email_normalized) do nothing;
      end if;
      -- §8.3: counts buffered while the Slack user was unmatched
      insert into slack_channel_activity (person_id, channel_id, activity_date, message_count)
      select v_target, ch.key, d.key::date, (d.value #>> '{}')::int
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

  update review_items set
    status = case when p_action = 'dismiss' then 'dismissed' else 'resolved' end::review_status_t,
    resolution = jsonb_build_object('action', p_action, 'person_id', v_target, 'drop_id', p_drop_id),
    resolved_by = auth.uid(), resolved_at = now()
  where id = p_item_id;
  return v_target;
end $$;

/* The header bulk action: every open no_match item becomes a new person, in one call. */
create function create_people_for_no_match() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select id from review_items where status = 'open' and kind = 'no_match' order by created_at loop
    perform resolve_review_item(r.id, 'create');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function resolve_review_item(uuid, text, uuid, uuid) from anon, public;
revoke execute on function create_people_for_no_match() from anon, public;
grant execute on function resolve_review_item(uuid, text, uuid, uuid) to authenticated;
grant execute on function create_people_for_no_match() to authenticated;
