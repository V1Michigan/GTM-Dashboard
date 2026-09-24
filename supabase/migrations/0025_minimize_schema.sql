-- Schema cleanup. Removes objects that duplicate another object or that nothing
-- reads:
--   event_stats          -> folded into events_list (the only other reader)
--   person_event_summary -> folded into people_list (the only other reader)
--   resolve_review_item  -> never called; /review resolves in TS
--   person_organizations -> always empty, only rendered as "none recorded"
--   fuzzystrmatch        -> levenshtein() left match_person in 0024

drop view events_list;
drop view event_stats;
drop view people_list;
drop view person_event_summary;
drop function resolve_review_item(uuid, text, uuid);
drop table person_organizations;
drop extension fuzzystrmatch;

create view events_list with (security_invoker = true) as
select e.*,
  count(a.id) filter (where a.registered)::int as registered_count,
  count(a.id) filter (where a.checked_in)::int as checked_in_count,
  count(a.id) filter (where a.checked_in and not a.registered)::int as walk_in_count,
  count(a.id) filter (where a.checked_in and p.is_v1_member)::int as member_checkin_count,
  (select count(*)::int
     from review_items ri
     join import_rows ir on ir.id = ri.import_row_id
     join imports i on i.id = ir.import_id
    where i.event_id = e.id and ri.status = 'open') as open_review_items
from events e
left join event_attendance a on a.event_id = e.id
left join people p on p.id = a.person_id
group by e.id;

create view people_list with (security_invoker = true) as
select p.*,
  (select e.email::text from person_emails e
    where e.person_id = p.id order by e.is_primary desc, e.created_at limit 1) as primary_email,
  (select count(*)::int from person_emails e where e.person_id = p.id) as email_count,
  (select count(*)::int from event_attendance a where a.person_id = p.id and a.registered) as events_registered,
  (select count(*)::int from event_attendance a where a.person_id = p.id and a.checked_in) as events_attended,
  (select count(*)::int from product_studio_applications a where a.person_id = p.id) as ps_applications,
  (select count(*)::int from coffee_chats c where c.person_id = p.id) as coffee_chats
from people p;

-- 0012 granted "all tables" once; views recreated here need it again.
grant select on events_list, people_list to authenticated;

-- Same body as 0011 minus the person_organizations step.
create or replace function merge_people(keep_id uuid, drop_id uuid) returns void
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
