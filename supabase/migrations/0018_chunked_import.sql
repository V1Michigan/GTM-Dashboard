/*
 * §4.8 says one transaction per import. On hosted Supabase that is not possible
 * for a large file: PostgREST arms a statement_timeout when the call begins, and
 * a statement cannot raise its own timeout once running, so a 1,759-row commit
 * was cancelled and rolled back every time.
 *
 * So the commit is chunked. Each call is its own transaction over at most
 * `p_limit` rows and returns how many it handled; the caller loops until 0, then
 * calls finalize_import. Rows are never deleted by an import (rule 6) and every
 * row-level failure is already recorded rather than aborting, so a partial run
 * is resumable simply by calling again — which is what makes splitting the
 * transaction safe here.
 */
create function apply_import_chunk(p_import_id uuid, p_limit int default 200)
returns int language plpgsql as $$
declare
  v_imp imports; r record; v_res text; v_done int := 0;
begin
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

-- Roster replacement and the counters run once, after the last chunk.
create function finalize_import(p_import_id uuid) returns void
language plpgsql as $$
declare
  v_imp imports;
begin
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

-- Kept for local use and for anything already calling it: loop to completion.
create or replace function apply_import(p_import_id uuid) returns void
language plpgsql as $$
begin
  while apply_import_chunk(p_import_id, 500) > 0 loop end loop;
  perform finalize_import(p_import_id);
end $$;
