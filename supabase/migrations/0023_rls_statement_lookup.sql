-- The role and person helpers depend only on the current caller, not on a
-- table row. A scalar subquery lets Postgres run each lookup as an InitPlan
-- once per statement instead of querying app_users for every examined row.
-- Keep the live allowlist check: JWT app_role remains routing-only, and role
-- changes still take effect on the next statement. No grants or RLS bypasses.
do $$
declare target record;
begin
  for target in
    select schemaname, tablename from pg_policies
    where schemaname = 'public' and policyname = 'admin_all'
  loop
    execute format(
      'alter policy admin_all on %I.%I
       using ((select public.current_app_role()) = ''admin'')
       with check ((select public.current_app_role()) = ''admin'')',
      target.schemaname, target.tablename
    );
  end loop;
end $$;

alter policy member_select_own on public.coffee_chats
  using (member_id = (select public.current_person_id()));
alter policy member_insert_own on public.coffee_chats
  with check (member_id = (select public.current_person_id()));
alter policy member_delete_recent on public.coffee_chats
  using (member_id = (select public.current_person_id()) and created_at > now() - interval '24 hours');
