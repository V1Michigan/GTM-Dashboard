/*
 * Storage RLS for the raw CSV uploads.
 *
 * §4.7 grants admins full access to every table in `public`, but the import
 * wizard also writes the uploaded file to Storage, and storage.objects has RLS
 * on with no policy — so an authenticated admin got "new row violates row-level
 * security policy" the moment the app ran as a real user instead of the
 * service role.
 *
 * The bucket is created here too. It was previously only declared in
 * config.toml, which builds it locally but never touches a linked project, so a
 * deployed environment had no bucket until someone made one by hand.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imports', 'imports', false, 52428800,
        array['text/csv', 'application/vnd.ms-excel', 'text/plain'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Admins only: the files carry names, emails and resume links. Members never
-- touch Storage, and the bucket stays private, so downloads go through the app.
drop policy if exists imports_admin_read on storage.objects;
drop policy if exists imports_admin_insert on storage.objects;
drop policy if exists imports_admin_update on storage.objects;
drop policy if exists imports_admin_delete on storage.objects;

create policy imports_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'imports' and public.current_app_role() = 'admin');

create policy imports_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'imports' and public.current_app_role() = 'admin');

create policy imports_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'imports' and public.current_app_role() = 'admin')
  with check (bucket_id = 'imports' and public.current_app_role() = 'admin');

create policy imports_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'imports' and public.current_app_role() = 'admin');
