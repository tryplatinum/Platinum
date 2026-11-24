-- Older "name or link" rows under a restricted or firm_only folder come under
-- the same owner-only rule as stored files filed there.
--
-- Until now such a row stayed readable by every member because it is not a
-- stored file. document_is_owner_only() is the one rule the policies on
-- documents, document_is_readable() and owner_only_file_count() all call, so
-- replacing it changes all of them together:
--
--   owner-only = the folder is restricted or firm_only, AND the row is either
--                a stored file that has been filed, or a row with no stored file
--                that is not an essay (a name or a link).
--
-- Essay rows have no folder and are not affected. A stored file that is still
-- uploading, sorting or waiting for a counselor is not affected either.

create or replace function public.document_is_owner_only(file_status text, storage_path text, kind text, type_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select type_id is not null
     and not public.document_type_is_open(type_id)
     and (coalesce(file_status = 'filed', false) or (storage_path is null and kind <> 'essay'))
$$;
