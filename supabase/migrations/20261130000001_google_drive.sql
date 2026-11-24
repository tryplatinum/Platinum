-- Google Drive: a counselor's Google connection, files that came from Drive,
-- and Drive folders linked to a student.
--
--   * google_connections      one row per counselor. Holds the encrypted refresh
--                             token. Row level security is on with NO policy and
--                             no grant for signed-in people: only the service
--                             role (the server) reads or writes it.
--   * documents (extended)    four nullable columns that say a stored file came
--                             from Drive and which Drive file it is.
--   * student_drive_folders   a Drive folder linked to a student, and how its
--                             sync is going. Firm members can read it (not the
--                             server's working state). Writes go through
--                             /api/google with the service role.
--
-- Additive only: new tables, new nullable columns, new indexes. Nothing is
-- dropped, renamed or replaced. apply_changes is not changed: it already copes
-- with new nullable columns, and the browser sends these four back unchanged.

-- ── The connection ──────────────────────────────────────────────────────────

create table public.google_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  firm_id uuid not null references public.firms (id) on delete cascade,
  google_address text not null check (char_length(google_address) <= 320),
  scopes text[] not null default '{}',
  -- AES-256-GCM, made by the server with GOOGLE_TOKEN_KEY. Never plain text.
  refresh_token_encrypted text not null,
  connected_at timestamptz not null default now(),
  -- 'reconnect' when Google says the grant is expired or revoked.
  last_error text check (last_error is null or char_length(last_error) <= 200),
  updated_at timestamptz not null default now()
);

create index google_connections_firm_idx on public.google_connections (firm_id);

alter table public.google_connections enable row level security;
-- No policy on purpose. With row level security on and no policy, a signed-in
-- person can do nothing here even if a grant were added by mistake.
revoke all on table public.google_connections from public, anon, authenticated;
grant all on table public.google_connections to service_role;

create trigger set_updated_at before update on public.google_connections
  for each row execute function public.set_updated_at();

-- ── Files that came from Drive ──────────────────────────────────────────────

alter table public.documents
  -- Null means an upload.
  add column source text check (source is null or source in ('upload', 'google_drive')),
  add column drive_file_id text check (drive_file_id is null or char_length(drive_file_id) <= 200),
  add column drive_url text check (drive_url is null or char_length(drive_url) <= 500),
  -- Drive's own "modified" time when the stored copy was taken.
  add column drive_modified_at timestamptz;

-- One stored copy of a Drive file per student.
create unique index documents_drive_file_idx on public.documents (firm_id, student_id, drive_file_id)
  where drive_file_id is not null;

-- ── Linked folders ──────────────────────────────────────────────────────────

create table public.student_drive_folders (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  -- Whose Google connection the sync uses. Null if that person's account is removed.
  linked_by uuid references auth.users (id) on delete set null,
  drive_folder_id text not null check (char_length(drive_folder_id) between 1 and 200),
  folder_name text not null check (char_length(folder_name) between 1 and 300),
  drive_url text check (drive_url is null or char_length(drive_url) <= 500),
  -- idle: up to date as of last_synced_at. syncing: a sync has more to do.
  -- reconnect: the linker's Google connection is gone. error: the last sync failed.
  status text not null default 'idle' check (status in ('idle', 'syncing', 'reconnect', 'error')),
  last_synced_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  progress_done integer not null default 0,
  progress_total integer not null default 0,
  -- Files the last sync left out, for the counselor: [{ "name": ..., "reason": ... }].
  skipped jsonb not null default '[]' check (jsonb_typeof(skipped) = 'array'),
  -- Drive files that were imported from this folder and are no longer in it.
  missing_file_ids text[] not null default '{}',
  -- How many files from this folder were deleted here and are not imported again.
  removed_here_count integer not null default 0,
  -- The server's working state: what is left to import, what was deleted here.
  -- Not granted to signed-in people (see the column grant below).
  sync_state jsonb not null default '{}' check (jsonb_typeof(sync_state) = 'object'),
  -- One sync at a time: a call holds the folder until this time.
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, drive_folder_id)
);

create index student_drive_folders_student_idx on public.student_drive_folders (firm_id, student_id);

alter table public.student_drive_folders enable row level security;
create policy student_drive_folders_select on public.student_drive_folders for select to authenticated
  using (public.is_firm_member(firm_id));
-- No insert, update or delete policy: writes go through the server.

revoke all on table public.student_drive_folders from public, anon, authenticated;
-- Every column except sync_state and lease_until.
grant select (
  id, firm_id, student_id, linked_by, drive_folder_id, folder_name, drive_url, status,
  last_synced_at, last_error, progress_done, progress_total, skipped, missing_file_ids,
  removed_here_count, created_at, updated_at
) on table public.student_drive_folders to authenticated;
grant all on table public.student_drive_folders to service_role;

create trigger set_updated_at before update on public.student_drive_folders
  for each row execute function public.set_updated_at();
