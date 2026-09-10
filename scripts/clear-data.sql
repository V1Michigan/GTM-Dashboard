-- Empty every data table, keeping app_users (the admin allowlist) and auth.users.
-- DELETE not TRUNCATE on purpose: app_users.person_id has an FK to people, so
-- TRUNCATE ... CASCADE would take the admin row with it and lock you out.
begin;
update app_users set person_id = null;
delete from field_changes;
delete from review_items;
delete from import_rows;
delete from imports;
delete from person_merges;
delete from webhook_inbox;
delete from saved_column_mappings;
delete from slack_event_dedupe;
delete from slack_unmatched_users;
delete from slack_channel_activity;
delete from slack_channels;
delete from coffee_chats;
delete from product_studio_applications;
delete from form_submissions;
delete from event_attendance;
delete from person_organizations;
delete from person_emails;
delete from events;
delete from people;
commit;
