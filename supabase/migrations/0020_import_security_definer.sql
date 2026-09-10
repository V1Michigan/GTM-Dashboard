/*
 * Committing a 531-row import timed out in production while the same work took
 * 66ms locally as a superuser. The difference is RLS: these functions ran with
 * the caller's privileges, so every statement inside the row loop re-evaluated
 * the admin policy on every table it touched, each evaluation calling
 * current_app_role(). Measured on identical data: 100 rows took 66ms as
 * superuser and 1,625ms as an authenticated admin, and 200 rows took 3.4s —
 * over Supabase's statement_timeout once production's slower compute is added.
 *
 * The import machinery is trusted server-side logic (§4.8 puts the merge rules
 * in SQL precisely so both the CSV importer and the webhooks share them), so it
 * now checks the caller is an admin once and runs as definer. apply_import_row
 * is deliberately NOT definer: it inherits definer rights when called from
 * apply_import_chunk, and stays RLS-bound when a client calls it directly to
 * resolve a single review item, where the per-row cost does not matter.
 */
create or replace function apply_import_chunk(p_import_id uuid, p_limit int default 200)
returns int language plpgsql security definer
 set search_path = public, pg_temp as $$
declare
  v_imp imports; r record; v_res text; v_done int := 0;
begin
  -- SECURITY DEFINER, so the caller is checked once here instead of RLS being
  -- re-evaluated for every statement of every row.
  --
  -- The check reads the JWT role claim, NOT current_user/session_user: inside a
  -- definer function both of those are the function's owner, so a check on them
  -- passes for everyone — including anon. The claim is set by PostgREST from the
  -- caller's key and is unaffected by the definer switch. anon carries no claims
  -- at all, hence the nullif before the cast.
  -- coalesce is load-bearing: current_app_role() is NULL for anon and for any
  -- caller with no app_users row, and `NULL = 'admin'` is NULL, so `if not (...)`
  -- would be NULL and the raise would never fire — the guard would pass silently
  -- for exactly the callers it exists to stop.
  if not coalesce(
    public.current_app_role()::text = 'admin'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
       = 'service_role'
    -- direct superuser access (psql, migrations); PostgREST connects as
    -- `authenticator`, so this arm never fires for an API caller
    or session_user in ('postgres', 'supabase_admin')
  , false) then
    raise exception 'this import function is restricted to admins';
  end if;

  select i.* into v_imp from imports i where i.id = p_import_id;
  if not found then raise exception 'import % not found', p_import_id; end if;

  for r in
    select ir.id from import_rows ir
    -- 'review' rows are included so a row the dry run could not match still gets
    -- a review_items entry — without that they are invisible in /review forever.
    -- But only until it HAS one: a review row keeps its status, so re-selecting
    -- it every chunk would loop until the guard trips.
    where ir.import_id = p_import_id
      and (ir.status = 'pending'
           or (ir.status = 'review' and not exists (
                 select 1 from review_items rv
                 where rv.import_row_id = ir.id and rv.status = 'open')))
    -- §4.8: duplicates of one person inside one import go oldest-first so the
    -- later row fills fields instead of conflicting. Ordered as text on purpose:
    -- a bad timestamp in one row must not abort the whole import.
    order by nullif(ir.parsed ->> 'submitted_at', '') nulls first, ir.row_index
    limit p_limit
  loop
    begin
      v_res := apply_import_row(r.id, v_imp.incoming_wins);
      v_done := v_done + 1;
    exception when others then
      update import_rows set status = 'failed', error = sqlerrm where id = r.id;
    end;
  end loop;


  return v_done;
end $$;

create or replace function finalize_import(p_import_id uuid) returns void
language plpgsql security definer
 set search_path = public, pg_temp as $$
declare
  v_imp imports;
begin
  -- SECURITY DEFINER, so the caller is checked once here instead of RLS being
  -- re-evaluated for every statement of every row.
  --
  -- The check reads the JWT role claim, NOT current_user/session_user: inside a
  -- definer function both of those are the function's owner, so a check on them
  -- passes for everyone — including anon. The claim is set by PostgREST from the
  -- caller's key and is unaffected by the definer switch. anon carries no claims
  -- at all, hence the nullif before the cast.
  -- coalesce is load-bearing: current_app_role() is NULL for anon and for any
  -- caller with no app_users row, and `NULL = 'admin'` is NULL, so `if not (...)`
  -- would be NULL and the raise would never fire — the guard would pass silently
  -- for exactly the callers it exists to stop.
  if not coalesce(
    public.current_app_role()::text = 'admin'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
       = 'service_role'
    -- direct superuser access (psql, migrations); PostgREST connects as
    -- `authenticator`, so this arm never fires for an API caller
    or session_user in ('postgres', 'supabase_admin')
  , false) then
    raise exception 'this import function is restricted to admins';
  end if;

  select i.* into v_imp from imports i where i.id = p_import_id for update;
  if not found then raise exception 'import % not found', p_import_id; end if;
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
    rows_new       = (select count(*) from import_rows ir where ir.import_id = p_import_id and ir.status = 'applied' and ir.person_id is not null),
    rows_updated   = 0,
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

create or replace function apply_import(p_import_id uuid) returns void
language plpgsql security definer
 set search_path = public, pg_temp as $$
begin
  -- SECURITY DEFINER, so the caller is checked once here instead of RLS being
  -- re-evaluated for every statement of every row.
  --
  -- The check reads the JWT role claim, NOT current_user/session_user: inside a
  -- definer function both of those are the function's owner, so a check on them
  -- passes for everyone — including anon. The claim is set by PostgREST from the
  -- caller's key and is unaffected by the definer switch. anon carries no claims
  -- at all, hence the nullif before the cast.
  -- coalesce is load-bearing: current_app_role() is NULL for anon and for any
  -- caller with no app_users row, and `NULL = 'admin'` is NULL, so `if not (...)`
  -- would be NULL and the raise would never fire — the guard would pass silently
  -- for exactly the callers it exists to stop.
  if not coalesce(
    public.current_app_role()::text = 'admin'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
       = 'service_role'
    -- direct superuser access (psql, migrations); PostgREST connects as
    -- `authenticator`, so this arm never fires for an API caller
    or session_user in ('postgres', 'supabase_admin')
  , false) then
    raise exception 'this import function is restricted to admins';
  end if;

  while apply_import_chunk(p_import_id, 500) > 0 loop end loop;
  perform finalize_import(p_import_id);
end $$;

revoke execute on function apply_import_chunk(uuid, int) from anon;
revoke execute on function finalize_import(uuid) from anon;
revoke execute on function apply_import(uuid) from anon;
