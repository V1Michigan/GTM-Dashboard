/*
 * Custom Access Token Hook: stamps the app role onto the JWT at sign-in and at
 * every token refresh, so middleware can route a request without asking the
 * database who the caller is.
 *
 * This claim is for ROUTING ONLY. Authorization stays in RLS, where
 * current_app_role() reads app_users live on every statement. A claim can be up
 * to `jwt_expiry` stale, so a demoted admin may still be routed to an admin page
 * until their token refreshes — and will find every query returns nothing,
 * because RLS never trusts the claim. That is the spec's own position: "Do not
 * rely on UI hiding; RLS is the enforcement" (§4.7).
 */
-- `set search_path` is required: the hook runs as supabase_auth_admin, whose
-- default search_path excludes public, so app_role_t would not resolve.
create function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable
set search_path = public, auth as $$
declare
  v_email text;
  v_role public.app_role_t;
  v_person uuid;
  v_claims jsonb;
begin
  select u.email into v_email from auth.users u where u.id = (event ->> 'user_id')::uuid;
  select a.role, a.person_id into v_role, v_person from app_users a where a.email = v_email::citext;

  v_claims := event -> 'claims';
  v_claims := jsonb_set(v_claims, '{app_role}', to_jsonb(coalesce(v_role::text, 'member')));
  v_claims := jsonb_set(v_claims, '{person_id}',
                        case when v_person is null then 'null'::jsonb else to_jsonb(v_person::text) end);

  return jsonb_set(event, '{claims}', v_claims);
end $$;

-- Only the auth server may run the hook, and it needs to read the allowlist.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on table public.app_users to supabase_auth_admin;

create policy app_users_auth_admin_read on app_users
  as permissive for select to supabase_auth_admin using (true);
