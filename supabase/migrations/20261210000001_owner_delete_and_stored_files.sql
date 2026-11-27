-- Two rules that belong with roles.
--
--   1. Only an owner can delete a student, by any path. apply_changes already
--      refuses a counselor (20261208000001). This closes the table itself: the
--      delete policy on students asked only for membership, so a counselor
--      could delete a row directly, and everything that goes with it. Editing
--      and archiving a student are unchanged for every member.
--
--   2. A stored file whose document row is gone is never readable. The bucket's
--      policies asked document_is_readable(), which answers yes when there is
--      no such row (it has to: the file log keeps lines about documents that
--      were deleted). The bucket now asks a stricter question of its own: the
--      row exists, belongs to the firm in the object's path, and is one the
--      caller may read. A missing row means no.
--
-- Both tighten. Nothing is loosened, and document_is_readable() is untouched.

-- ── Only an owner deletes a student ─────────────────────────────────────────

drop policy students_delete on public.students;
create policy students_delete on public.students for delete to authenticated using (public.is_firm_owner(firm_id));

-- ── A stored file needs its row ─────────────────────────────────────────────

-- True only when the document row exists in that firm and the caller may read
-- it: a member of the firm, and the owner when the document is owner-only.
create function public.stored_file_is_readable(firm uuid, document uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.is_firm_member(d.firm_id)
       and (public.is_firm_owner(d.firm_id) or not public.document_is_owner_only(d.file_status, d.storage_path, d.kind, d.type_id))
    from public.documents d
    where d.id = document and d.firm_id = firm), false)
$$;

revoke execute on function public.stored_file_is_readable(uuid, uuid) from public, anon;
grant execute on function public.stored_file_is_readable(uuid, uuid) to authenticated, service_role;

drop policy documents_objects_select on storage.objects;
create policy documents_objects_select on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and public.is_firm_member(public.path_uuid(name, 1))
    and public.path_uuid(name, 3) is not null
    and public.stored_file_is_readable(public.path_uuid(name, 1), public.path_uuid(name, 3))
  );

drop policy documents_objects_delete on storage.objects;
create policy documents_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and public.is_firm_member(public.path_uuid(name, 1))
    and public.path_uuid(name, 3) is not null
    and public.stored_file_is_readable(public.path_uuid(name, 1), public.path_uuid(name, 3))
  );
