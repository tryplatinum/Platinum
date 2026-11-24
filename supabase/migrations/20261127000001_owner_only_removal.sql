-- Owner-only files cannot be removed by other members.
--
--   * document_is_owner_only()   the one rule for "only the firm's owner may read this
--                                document". The three policies on documents and
--                                document_is_readable() now call it, so the rule lives
--                                in one place. The rule itself is unchanged here: a
--                                stored file that is filed under a restricted or
--                                firm_only folder.
--   * owner_only_file_count()    how many such documents a firm, or some of its students,
--                                have. A member may know the number, not the files.
--   * apply_changes              refuses to delete a student, or clear the caseload, for
--                                anyone but the owner when that would take owner-only
--                                files with it. Nothing else in it changes.

create function public.document_is_owner_only(file_status text, storage_path text, kind text, type_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select type_id is not null
     and not public.document_type_is_open(type_id)
     and coalesce(file_status = 'filed', false)
$$;

revoke execute on function public.document_is_owner_only(text, text, text, uuid) from public, anon;
grant execute on function public.document_is_owner_only(text, text, text, uuid) to authenticated, service_role;

create or replace function public.document_is_readable(document uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.is_firm_owner(d.firm_id)
        or not public.document_is_owner_only(d.file_status, d.storage_path, d.kind, d.type_id)
    from public.documents d where d.id = document), true)
$$;

drop policy documents_select on public.documents;
drop policy documents_update on public.documents;
drop policy documents_delete on public.documents;

create policy documents_select on public.documents for select to authenticated
  using (
    public.is_firm_member(firm_id)
    and (public.is_firm_owner(firm_id) or not public.document_is_owner_only(file_status, storage_path, kind, type_id))
  );

create policy documents_update on public.documents for update to authenticated
  using (
    public.is_firm_member(firm_id)
    and (public.is_firm_owner(firm_id) or not public.document_is_owner_only(file_status, storage_path, kind, type_id))
  )
  with check (public.is_firm_member(firm_id));

create policy documents_delete on public.documents for delete to authenticated
  using (
    public.is_firm_member(firm_id)
    and (public.is_firm_owner(firm_id) or not public.document_is_owner_only(file_status, storage_path, kind, type_id))
  );

-- How many owner-only documents the firm has, or the given students have.
-- Security definer so a counselor who cannot read them can still be told how
-- many are in the way. It checks membership itself and returns only a number.
create function public.owner_only_file_count(firm uuid, students uuid[] default null)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_firm_member(firm) then
    raise exception 'You are not a member of this firm.' using errcode = '42501';
  end if;
  return (
    select count(*)::integer
    from public.documents d
    where d.firm_id = owner_only_file_count.firm
      and (owner_only_file_count.students is null or d.student_id = any (owner_only_file_count.students))
      and public.document_is_owner_only(d.file_status, d.storage_path, d.kind, d.type_id)
  );
end
$$;

revoke execute on function public.owner_only_file_count(uuid, uuid[]) from public, anon;
grant execute on function public.owner_only_file_count(uuid, uuid[]) to authenticated;

create or replace function public.apply_changes(firm uuid, changes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Parents before children, so foreign keys hold inside the batch.
  upsert_order constant text[] := array['document_types', 'students', 'parents', 'meetings', 'tasks', 'colleges', 'documents', 'reports', 'outbox', 'reminder_rules', 'activity', 'personal_notes', 'weekly_texts', 'college_list_drafts', 'college_list_draft_items'];
  -- The log tables (outbox, activity) are never deleted from row by row, and
  -- folders (document_types) are archived, not deleted.
  delete_order constant text[] := array['college_list_draft_items', 'college_list_drafts', 'weekly_texts', 'personal_notes', 'documents', 'reports', 'colleges', 'tasks', 'meetings', 'parents', 'students'];
  t text;
  items jsonb;
  cols text;
  vals text;
  sets text;
  blocked integer := 0;
begin
  if not public.is_firm_member(firm) then
    raise exception 'You are not a member of this firm.' using errcode = '42501';
  end if;

  -- Deleting a student, or clearing the caseload, takes the student's documents
  -- with it. When any of those is owner-only, only the owner may do it.
  if not public.is_firm_owner(firm) then
    if coalesce((changes ->> 'clear')::boolean, false) then
      blocked := public.owner_only_file_count(firm);
    elsif jsonb_typeof(changes -> 'delete' -> 'students') = 'array' and jsonb_array_length(changes -> 'delete' -> 'students') > 0 then
      blocked := public.owner_only_file_count(
        firm, array(select value::uuid from jsonb_array_elements_text(changes -> 'delete' -> 'students')));
    end if;
    if blocked > 0 then
      raise exception '% in the way: only the firm''s owner can open %, so only the owner can %. Nothing was changed.',
        case blocked when 1 then '1 owner-only file is' else blocked || ' owner-only files are' end,
        case blocked when 1 then 'it' else 'them' end,
        case when coalesce((changes ->> 'clear')::boolean, false) then 'clear the caseload' else 'delete this student' end
        using errcode = '42501';
    end if;
  end if;

  if changes -> 'firm' ? 'name' then
    update public.firms set name = btrim(changes -> 'firm' ->> 'name') where id = firm;
    if not found then
      raise exception 'Only the firm''s owner can rename it.' using errcode = '42501';
    end if;
  end if;
  if changes -> 'firm' ? 'displayName' then
    update public.firm_members set display_name = btrim(changes -> 'firm' ->> 'displayName')
    where firm_id = firm and user_id = (select auth.uid());
    if not found then
      raise exception 'Only the firm''s owner can change member names.' using errcode = '42501';
    end if;
  end if;

  if changes -> 'firm' ? 'weeklyTextDay' then
    update public.firms set weekly_text_day = (changes -> 'firm' ->> 'weeklyTextDay')::smallint where id = firm;
    if not found then
      raise exception 'Only the firm''s owner can change firm settings.' using errcode = '42501';
    end if;
  end if;

  if changes -> 'firm' ? 'sortFilesAutomatically' then
    update public.firms set sort_files_automatically = (changes -> 'firm' ->> 'sortFilesAutomatically')::boolean where id = firm;
    if not found then
      raise exception 'Only the firm''s owner can change firm settings.' using errcode = '42501';
    end if;
  end if;

  if coalesce((changes ->> 'clear')::boolean, false) then
    -- Everything that belongs to a student goes with the student.
    delete from public.students where firm_id = firm;
    delete from public.reminder_rules where firm_id = firm;
  end if;

  foreach t in array upsert_order loop
    items := changes -> 'upsert' -> t;
    continue when items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0;

    -- Every column except the ones the database fills in. firm_id always comes
    -- from the argument, never from the payload.
    select
      string_agg(format('%I', a.attname), ', ' order by a.attnum),
      string_agg(
        case a.attname
          when 'firm_id' then '$2'
          when 'id' then 'coalesce(r.id, gen_random_uuid())'
          else
            -- A required column the payload leaves out takes its default, so a
            -- browser still running an older version keeps working after a
            -- column is added.
            case when a.attnotnull and d.adbin is not null
              then format('coalesce(r.%I, %s)', a.attname, pg_catalog.pg_get_expr(d.adbin, d.adrelid))
              else format('r.%I', a.attname)
            end
        end, ', ' order by a.attnum),
      string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ' order by a.attnum)
        filter (where a.attname not in ('id', 'firm_id'))
    into cols, vals, sets
    from pg_catalog.pg_attribute a
    left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = format('public.%I', t)::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname not in ('seq', 'created_at', 'updated_at');

    execute format(
      'insert into public.%1$I (%2$s)
       select %3$s
       from jsonb_array_elements($1) with ordinality as e(value, ord)
       cross join lateral jsonb_populate_record(null::public.%1$I, e.value) as r
       order by e.ord
       on conflict %4$s do update set %5$s',
      t, cols, vals,
      case t when 'reminder_rules' then '(firm_id, rule)' else '(id)' end,
      sets)
    using items, firm;
  end loop;

  foreach t in array delete_order loop
    items := changes -> 'delete' -> t;
    continue when items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0;
    execute format(
      'delete from public.%I where firm_id = $2 and id in (select value::uuid from jsonb_array_elements_text($1))', t)
    using items, firm;
  end loop;
end
$$;
