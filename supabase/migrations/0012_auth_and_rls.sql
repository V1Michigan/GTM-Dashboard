-- Spec §4.7 and §5. Two roles: admin (the dashboard) and member (coffee chats only).
create table app_users (
  email citext primary key,
  role app_role_t not null default 'member',
  person_id uuid references people(id) on delete set null,
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ::citext on both: citext = text resolves to the case-sensitive text operator.
create function current_app_role() returns app_role_t
language sql stable security definer set search_path = public, pg_temp as
  $$ select role from app_users where email = auth.email()::citext $$;

create function current_person_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as
  $$ select person_id from app_users where email = auth.email()::citext $$;

/*
 * Who may sign in: a umich account that is either on the allowlist or belongs to
 * a current V1 member. `hd=umich.edu` on the OAuth call is only a hint — this
 * trigger is the enforcement.
 */
create function auth_user_allowed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email is null or lower(new.email) not like '%@umich.edu' then
    raise exception 'Only @umich.edu accounts may sign in';
  end if;
  if not exists (select 1 from app_users a where a.email = new.email::citext)
     and not exists (select 1 from person_emails pe join people p on p.id = pe.person_id
                     where pe.email_normalized = normalize_email(new.email) and p.is_v1_member) then
    raise exception 'Account % is not on the V1 allowlist', new.email;
  end if;
  return new;
end $$;
create trigger check_v1_allowlist before insert on auth.users
  for each row execute function auth_user_allowed();

-- A V1 member who got past the check but is not on the allowlist becomes a
-- `member` linked to their person row.
create function auth_user_provision() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into app_users (email, role, person_id)
  select new.email::citext, 'member', p.id
    from person_emails pe join people p on p.id = pe.person_id
   where pe.email_normalized = normalize_email(new.email) and p.is_v1_member
   limit 1
  on conflict (email) do nothing;
  return new;
end $$;
create trigger provision_app_user after insert on auth.users
  for each row execute function auth_user_provision();

-- RLS on every table, including the ones only the service role touches
-- (service_role bypasses RLS; anon is granted nothing).
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy admin_all on public.%I for all to authenticated
       using (current_app_role() = ''admin'') with check (current_app_role() = ''admin'')', t);
  end loop;
end $$;

-- The member role's only reachable rows. No update policy: a logged chat is
-- corrected by deleting it inside the 24h window and logging it again.
create policy member_select_own on coffee_chats for select to authenticated
  using (member_id = current_person_id());
create policy member_insert_own on coffee_chats for insert to authenticated
  with check (member_id = current_person_id());
create policy member_delete_recent on coffee_chats for delete to authenticated
  using (member_id = current_person_id() and created_at > now() - interval '24 hours');

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- people_directory is the security-definer view from 0008: the only people data
-- a member may read, and the reason members need no policy on `people`.
grant select on people_directory to authenticated;
revoke execute on function member_log_coffee_chat(text, text, date, text) from public;
grant execute on function member_log_coffee_chat(text, text, date, text) to authenticated;
