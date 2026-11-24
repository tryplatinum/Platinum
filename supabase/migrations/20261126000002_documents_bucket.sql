-- The bucket files are stored in, and who can reach its objects.
--
--   * One private bucket, "documents". 25 MB per file. PDF, JPEG, PNG, HEIC, DOCX, XLSX.
--   * Object path: {firm_id}/{student_id or _}/{document_id}/{safe name}. It never changes.
--   * A signed-in person reaches an object only when the first path segment is
--     their firm AND they may read the document in the third segment (so a file
--     in a restricted folder is the owner's only, like its row).
--   * A signed-in person can upload only to the exact path of a document row of
--     their firm whose file_status is 'uploading'.
--   * Nothing for anon. No public URLs. No update policy: an object is never
--     renamed, moved or overwritten.
--
-- The student link uploads through a one-time signed URL made by the server, so
-- it needs no policy here.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- The uuid in one segment of an object path, or null when it is not a uuid
-- (so a malformed path is refused instead of raising an error).
create function public.path_uuid(path text, segment integer)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(path, '/', segment) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(path, '/', segment)::uuid
  end
$$;

revoke execute on function public.path_uuid(text, integer) from public, anon;
grant execute on function public.path_uuid(text, integer) to authenticated, service_role;

create policy documents_objects_select on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and public.is_firm_member(public.path_uuid(name, 1))
    and public.path_uuid(name, 3) is not null
    and public.document_is_readable(public.path_uuid(name, 3))
  );

create policy documents_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.is_firm_member(public.path_uuid(name, 1))
    -- Only into the exact path of a document row of that firm that is waiting
    -- for its file. The row is made first, with file_status 'uploading'.
    -- (objects.name is spelled out: documents has a column called name too.)
    and exists (
      select 1 from public.documents d
      where d.id = public.path_uuid(objects.name, 3)
        and d.firm_id = public.path_uuid(objects.name, 1)
        and d.file_status = 'uploading'
        and d.storage_path = objects.name
    )
  );

create policy documents_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and public.is_firm_member(public.path_uuid(name, 1))
    and public.path_uuid(name, 3) is not null
    and public.document_is_readable(public.path_uuid(name, 3))
  );
