-- SUPERSEDED BY 0018. This tried to lift the statement_timeout from inside
-- apply_import, which cannot work: Postgres arms the timeout when a statement
-- begins, so a statement cannot extend its own deadline. Kept because it is
-- already applied to the linked project; 0018 replaces apply_import with a
-- chunked version that stays well inside the timeout instead.
-- One transaction per import (the caller's). Row-level failures are recorded on
-- the row and do not abort the rest (§4.8).
create or replace function apply_import(p_import_id uuid) returns void
language plpgsql as $$
declare
  v_imp imports; r record; v_res text; v_new int := 0; v_upd int := 0;
begin
  perform set_config('statement_timeout', '300s', true);

  select i.* into v_imp from imports i where i.id = p_import_id for update;
  if not found then raise exception 'import % not found', p_import_id; end if;

  for r in
    select ir.id from import_rows ir
    -- 'review' included on purpose: the dry run stages a row it could not match
    -- with that status, and if the commit skipped those they would never get a
    -- review_items row and would be invisible in /review forever.
    where ir.import_id = p_import_id and ir.status in ('pending', 'review')
    -- §4.8: duplicates of one person inside one import go oldest-first so the
    -- later row fills fields instead of conflicting. Ordered as text on purpose:
    -- a bad timestamp in one row must not abort the whole import.
    order by nullif(ir.parsed ->> 'submitted_at', '') nulls first, ir.row_index
  loop
    begin
      v_res := apply_import_row(r.id, v_imp.incoming_wins);
      if v_res = 'new' then v_new := v_new + 1;
      elsif v_res = 'updated' then v_upd := v_upd + 1;
      end if;
    exception when others then
      update import_rows set status = 'failed', error = sqlerrm where id = r.id;
    end;
  end loop;

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
    rows_new       = v_new,
    rows_updated   = v_upd,
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
