-- File storage: real files, the folders they are sorted into, and a log of what
-- happened to each one.
--
--   * document_types            a firm's folders ("Transcripts and grades", ...), with how
--                               sensitive each is. Seeded for every firm, old and new.
--   * documents (extended)      the same table essays live in. A stored file is a row with
--                               storage_path set. Essay rows are not touched.
--   * document_events           insert-only log: uploaded, sorted, viewed, deleted, ...
--   * firms.sort_files_automatically   owner's switch for sorting with AI, on by default
--   * file_document()           files a document under a folder and logs it, in one step
--
-- Who can read a file: any member of the firm, until it is filed under a folder
-- marked restricted or firm_only. From then on, the firm's owner only.

alter table public.firms add column sort_files_automatically boolean not null default true;

-- ── Folders ─────────────────────────────────────────────────────────────────

create table public.document_types (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- One line, shown to counselors and given to the model that sorts files.
  description text not null default '' check (char_length(description) <= 200),
  sensitivity text not null default 'standard' check (sensitivity in ('standard', 'restricted', 'firm_only')),
  position integer not null default 0,
  -- Archived folders take no new files. Files already in them stay where they are.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, name),
  -- Target of the composite foreign key from documents.
  unique (firm_id, id)
);

alter table public.document_types enable row level security;
create policy document_types_select on public.document_types for select to authenticated using (public.is_firm_member(firm_id));
-- Only the firm's owner changes the folders. There is no delete policy: folders are archived.
create policy document_types_insert on public.document_types for insert to authenticated with check (public.is_firm_owner(firm_id));
create policy document_types_update on public.document_types for update to authenticated
  using (public.is_firm_owner(firm_id)) with check (public.is_firm_owner(firm_id));

revoke all on table public.document_types from public, anon, authenticated;
grant select, insert, update on table public.document_types to authenticated;
grant all on table public.document_types to service_role;

create trigger set_updated_at before update on public.document_types
  for each row execute function public.set_updated_at();

-- The folders every firm starts with.
create function public.seed_document_types(firm uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.document_types (firm_id, name, description, sensitivity, position)
  values
    (firm, 'Transcripts and grades', 'School transcripts, report cards and grade reports.', 'standard', 1),
    (firm, 'Test scores', 'SAT, ACT, AP, IB, TOEFL and other score reports.', 'standard', 2),
    (firm, 'Activities and resume', 'Resumes, activity lists, certificates and portfolios.', 'standard', 3),
    (firm, 'Essays and writing', 'Essay drafts, writing samples and supplements kept as files.', 'standard', 4),
    (firm, 'Recommendations', 'Recommendation letters, brag sheets and requests to recommenders.', 'standard', 5),
    (firm, 'Applications', 'Application forms, confirmations and screenshots of submitted applications.', 'standard', 6),
    (firm, 'Decisions and awards', 'Admission decisions, scholarship and award letters.', 'restricted', 7),
    (firm, 'Financial aid', 'FAFSA, CSS Profile, tax forms, aid offers and other family finances.', 'restricted', 8),
    (firm, 'Identity and visa', 'Passports, IDs, visas, I-20s and birth certificates.', 'restricted', 9),
    (firm, 'Firm paperwork', 'Contracts, invoices and agreements between the family and the firm.', 'firm_only', 10),
    (firm, 'Other', 'Anything that fits no other folder.', 'standard', 11)
  on conflict (firm_id, name) do nothing
$$;

revoke execute on function public.seed_document_types(uuid) from public, anon, authenticated;

select public.seed_document_types(f.id) from public.firms f;

-- A new firm gets its folders in the same transaction. Nothing else in create_firm changes.
create or replace function public.create_firm(name text, display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_firm uuid;
begin
  if caller is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if exists (select 1 from public.firm_members m where m.user_id = caller) then
    raise exception 'This account already belongs to a firm.' using errcode = '23505';
  end if;

  insert into public.firms (name) values (btrim(create_firm.name)) returning id into new_firm;
  insert into public.firm_members (firm_id, user_id, role, display_name)
  values (new_firm, caller, 'owner', btrim(create_firm.display_name));
  perform public.seed_document_types(new_firm);
  return new_firm;
end
$$;

-- ── Documents: the columns a stored file needs ──────────────────────────────
-- Every new column is nullable or has a default, so essay rows and the older
-- "name or link only" rows are valid as they stand.

alter table public.documents
  add column type_id uuid,
  add column title text check (title is null or length(btrim(title)) between 1 and 200),
  add column original_filename text check (original_filename is null or char_length(original_filename) <= 300),
  -- {firm_id}/{student_id or _}/{document_id}/{safe name}. Set once, never changed.
  add column storage_path text unique,
  add column size_bytes bigint check (size_bytes is null or size_bytes between 0 and 26214400),
  add column mime_type text,
  add column content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  add column college_id uuid references public.colleges (id) on delete set null,
  add column school_year text check (school_year is null or char_length(school_year) <= 20),
  add column uploaded_by_kind text check (uploaded_by_kind in ('counselor', 'student_link')),
  add column uploaded_by_user uuid references auth.users (id) on delete set null,
  -- Where a stored file is in its life. Named file_status because documents.status
  -- already holds an essay's status. Null on rows that are not stored files.
  add column file_status text check (file_status in ('uploading', 'sorting', 'suggested', 'filed')),
  add column sorted_by text check (sorted_by in ('person', 'auto')),
  add column needs_check boolean not null default false,
  -- What the model proposed: {typeId, title, schoolYear, studentName, reason, alternatives, sure, model, at}. Kept after filing.
  add column ai_suggestion jsonb check (ai_suggestion is null or jsonb_typeof(ai_suggestion) = 'object'),
  -- When a counselor first opened it. Null shows as "New".
  add column opened_at timestamptz,
  add constraint documents_type_fkey foreign key (firm_id, type_id) references public.document_types (firm_id, id),
  add constraint documents_file_has_status check (storage_path is null or file_status is not null),
  add constraint documents_filed_has_type check (file_status is distinct from 'filed' or type_id is not null);

-- A counselor's upload made outside a student page has no student until it is
-- filed. Everything else still belongs to a student.
alter table public.documents alter column student_id drop not null;
alter table public.documents add constraint documents_student_unless_waiting
  check (student_id is not null or file_status in ('uploading', 'sorting', 'suggested'));

create index documents_type_idx on public.documents (type_id) where type_id is not null;
create index documents_file_status_idx on public.documents (firm_id, file_status) where file_status is not null;
create index documents_hash_idx on public.documents (firm_id, student_id, content_hash) where content_hash is not null;
create index documents_college_idx on public.documents (college_id) where college_id is not null;

-- Older rows that are not essays go into the matching folder, so they show in
-- the right group. They are not stored files: file_status stays null.
update public.documents d
set type_id = t.id
from public.document_types t
where t.firm_id = d.firm_id
  and d.kind <> 'essay'
  and d.type_id is null
  and t.name = case
    when d.kind = 'transcript' then 'Transcripts and grades'
    when d.kind = 'score_report' then 'Test scores'
    when d.kind = 'recommendation' then 'Recommendations'
    when d.kind = 'resume' then 'Activities and resume'
    when d.category = 'academic' then 'Transcripts and grades'
    when d.category = 'testing' then 'Test scores'
    when d.category = 'application' then 'Applications'
    when d.category = 'recommendation' then 'Recommendations'
    when d.category = 'financial' then 'Financial aid'
    else 'Other'
  end;

-- ── Who can read a document ─────────────────────────────────────────────────

-- True for a folder any member may read. Security definer so it answers the
-- same for everyone; it reveals only yes or no about a folder id.
create function public.document_type_is_open(type uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select t.sensitivity = 'standard' from public.document_types t where t.id = type), true)
$$;

-- The same rule for a document id, for the tables and the bucket that refer to
-- a document without holding its row. True when there is no such row.
create function public.document_is_readable(document uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select d.file_status is distinct from 'filed'
        or d.type_id is null
        or public.is_firm_owner(d.firm_id)
        or public.document_type_is_open(d.type_id)
    from public.documents d where d.id = document), true)
$$;

revoke execute on function public.document_type_is_open(uuid) from public, anon;
revoke execute on function public.document_is_readable(uuid) from public, anon;
grant execute on function public.document_type_is_open(uuid) to authenticated, service_role;
grant execute on function public.document_is_readable(uuid) to authenticated, service_role;

-- Replaces the generic policies on documents. Insert is unchanged.
drop policy documents_select on public.documents;
drop policy documents_update on public.documents;
drop policy documents_delete on public.documents;

create policy documents_select on public.documents for select to authenticated
  using (
    public.is_firm_member(firm_id)
    and (
      file_status is distinct from 'filed'
      or type_id is null
      or public.is_firm_owner(firm_id)
      or public.document_type_is_open(type_id)
    )
  );

-- What a person cannot read, they cannot change or delete either.
create policy documents_update on public.documents for update to authenticated
  using (
    public.is_firm_member(firm_id)
    and (
      file_status is distinct from 'filed'
      or type_id is null
      or public.is_firm_owner(firm_id)
      or public.document_type_is_open(type_id)
    )
  )
  with check (public.is_firm_member(firm_id));

create policy documents_delete on public.documents for delete to authenticated
  using (
    public.is_firm_member(firm_id)
    and (
      file_status is distinct from 'filed'
      or type_id is null
      or public.is_firm_owner(firm_id)
      or public.document_type_is_open(type_id)
    )
  );

-- ── The log ─────────────────────────────────────────────────────────────────

create table public.document_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  -- No foreign key: the log outlives the document, so "deleted" can be recorded.
  document_id uuid not null,
  actor_kind text not null check (actor_kind in ('counselor', 'student_link', 'system')),
  actor_user uuid references auth.users (id) on delete set null,
  action text not null check (action in ('uploaded', 'auto_sorted', 'suggested', 'approved', 'typed', 'renamed', 'viewed', 'downloaded', 'deleted')),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);

create index document_events_document_idx on public.document_events (firm_id, document_id, created_at);

alter table public.document_events enable row level security;
-- Insert only: there are no update or delete policies, and no such privileges.
create policy document_events_select on public.document_events for select to authenticated
  using (public.is_firm_member(firm_id) and public.document_is_readable(document_id));
-- A signed-in person can only log their own actions. The student link and the
-- sorter write through the server.
create policy document_events_insert on public.document_events for insert to authenticated
  with check (
    public.is_firm_member(firm_id)
    and actor_kind = 'counselor'
    and actor_user = (select auth.uid())
    and public.document_is_readable(document_id)
  );

revoke all on table public.document_events from public, anon, authenticated;
grant select, insert on table public.document_events to authenticated;
grant all on table public.document_events to service_role;

-- ── Filing ──────────────────────────────────────────────────────────────────
-- Puts a document under a folder (and a student, if it has none yet) and logs
-- it, in one transaction. Security definer because a counselor may file a
-- document into a restricted folder, after which they can no longer read it;
-- an ordinary update would be refused for that reason. It checks membership
-- itself and never touches a document the caller cannot read.

create function public.file_document(
  document uuid,
  type uuid,
  title text,
  student uuid default null,
  school_year text default null,
  action text default 'approved'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  d public.documents%rowtype;
begin
  select * into d from public.documents x where x.id = file_document.document for update;
  if not found or not public.is_firm_member(d.firm_id) or not public.document_is_readable(d.id) then
    raise exception 'That document was not found.' using errcode = '42501';
  end if;
  if d.storage_path is null then
    raise exception 'Only a stored file can be filed.' using errcode = '22023';
  end if;
  if file_document.action not in ('approved', 'typed') then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.document_types t where t.id = file_document.type and t.firm_id = d.firm_id) then
    raise exception 'That folder was not found.' using errcode = '22023';
  end if;
  if coalesce(file_document.student, d.student_id) is null then
    raise exception 'Choose a student first.' using errcode = '22023';
  end if;
  if file_document.student is not null
     and not exists (select 1 from public.students s where s.id = file_document.student and s.firm_id = d.firm_id) then
    raise exception 'That student was not found.' using errcode = '22023';
  end if;

  update public.documents x
  set type_id = file_document.type,
      title = btrim(file_document.title),
      name = btrim(file_document.title),
      student_id = coalesce(file_document.student, x.student_id),
      school_year = coalesce(nullif(btrim(file_document.school_year), ''), x.school_year),
      file_status = 'filed',
      sorted_by = 'person',
      needs_check = false
  where x.id = d.id;

  insert into public.document_events (firm_id, document_id, actor_kind, actor_user, action, detail)
  values (d.firm_id, d.id, 'counselor', caller, file_document.action,
          jsonb_build_object('typeId', file_document.type, 'fromTypeId', d.type_id, 'wasStatus', d.file_status));
end
$$;

revoke execute on function public.file_document(uuid, uuid, text, uuid, text, text) from public, anon;
grant execute on function public.file_document(uuid, uuid, text, uuid, text, text) to authenticated;
