-- Every count the dashboard shows comes from here (spec §4.3, §6).
-- security_invoker = true so the reader's RLS still applies through the view;
-- people_directory is the one deliberate exception, see below.

create view event_stats with (security_invoker = true) as
select e.id as event_id, e.name, e.event_date,
  count(*) filter (where a.registered) as registered_count,
  count(*) filter (where a.checked_in) as checked_in_count,
  count(*) filter (where a.checked_in and not a.registered) as walk_in_count,
  count(*) filter (where a.checked_in and p.is_v1_member) as member_checkin_count
from events e
left join event_attendance a on a.event_id = e.id
left join people p on p.id = a.person_id
group by e.id;

create view person_event_summary with (security_invoker = true) as
select p.id as person_id,
  count(*) filter (where a.registered) as events_registered,
  count(*) filter (where a.checked_in) as events_attended,
  max(a.checked_in_at) as last_attended_at
from people p left join event_attendance a on a.person_id = p.id
group by p.id;

-- Spec §4.7: the only people data a `member` may read. This view is
-- security_definer (the default) on purpose — it is the column-narrowed
-- projection that lets members read names/emails without a select policy on
-- `people`, which would expose gender, grad year, notes and Slack ids.
create view people_directory as
select p.id, p.first_name, p.last_name,
  (select e.email::text from person_emails e
    where e.person_id = p.id order by e.is_primary desc, e.created_at limit 1) as primary_email,
  p.is_v1_member
from people p;

create view people_list with (security_invoker = true) as
select p.*,
  (select e.email::text from person_emails e
    where e.person_id = p.id order by e.is_primary desc, e.created_at limit 1) as primary_email,
  (select count(*)::int from person_emails e where e.person_id = p.id) as email_count,
  coalesce(s.events_registered, 0)::int as events_registered,
  coalesce(s.events_attended, 0)::int as events_attended,
  (select count(*)::int from product_studio_applications a where a.person_id = p.id) as ps_applications,
  (select count(*)::int from coffee_chats c where c.person_id = p.id) as coffee_chats
from people p
left join person_event_summary s on s.person_id = p.id;

create view events_list with (security_invoker = true) as
select e.*,
  s.registered_count, s.checked_in_count, s.walk_in_count, s.member_checkin_count,
  (select count(*)::int
     from review_items ri
     join import_rows ir on ir.id = ri.import_row_id
     join imports i on i.id = ir.import_id
    where i.event_id = e.id and ri.status = 'open') as open_review_items
from events e
join event_stats s on s.event_id = e.id;

create view slack_channel_stats with (security_invoker = true) as
select c.*,
  count(distinct a.person_id)::int as active_people,
  coalesce(sum(a.message_count) filter (where a.activity_date > current_date - 7), 0)::int as messages_7d,
  coalesce(sum(a.message_count) filter (where a.activity_date > current_date - 30), 0)::int as messages_30d,
  coalesce(sum(a.message_count), 0)::int as messages_all
from slack_channels c
left join slack_channel_activity a on a.channel_id = c.id
group by c.id;

-- One row. "This semester" = the current academic term: Jan–Jul is that year's
-- winter/spring, Aug–Dec is that year's fall.
create view overview_stats with (security_invoker = true) as
with term as (
  select case when extract(month from current_date) < 8
              then make_date(extract(year from current_date)::int, 1, 1)
              else make_date(extract(year from current_date)::int, 8, 1) end as starts,
         case when extract(month from current_date) < 8
              then make_date(extract(year from current_date)::int, 8, 1)
              else make_date(extract(year from current_date)::int + 1, 1, 1) end as ends
)
select
  (select count(*)::int from people) as total_people,
  (select count(*)::int from people where is_v1_member) as members,
  (select count(*)::int from people where slack_joined_at is not null) as in_slack,
  (select count(*)::int from events e, term t
    where e.event_date >= t.starts and e.event_date < t.ends) as events_this_semester,
  (select count(*)::int from review_items where status = 'open') as open_review_items;
