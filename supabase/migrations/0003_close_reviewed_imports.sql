/*
 * An import's status was decided once, at commit: needs_review if any of its
 * rows had an open review item. Resolving those items later never revisited it,
 * so an import said "Needs review" forever. This trigger closes the import when
 * its last open item is resolved or dismissed, on every path that does so
 * (/review, the bulk no-match action, the Slack handler).
 */
create function close_reviewed_import() returns trigger language plpgsql as $$
begin
  update imports i set status = 'committed'
    from import_rows ir
   where ir.id = new.import_row_id
     and i.id = ir.import_id
     and i.status = 'needs_review'
     and not exists (select 1 from review_items rv join import_rows r on r.id = rv.import_row_id
                      where r.import_id = i.id and rv.status = 'open');
  return null;
end $$;

create trigger close_reviewed_import after update of status on review_items
  for each row when (old.status = 'open' and new.status <> 'open' and new.import_row_id is not null)
  execute function close_reviewed_import();

-- Imports already stuck in needs_review with nothing left open.
update imports i set status = 'committed'
 where i.status = 'needs_review'
   and not exists (select 1 from review_items rv join import_rows r on r.id = rv.import_row_id
                    where r.import_id = i.id and rv.status = 'open');
