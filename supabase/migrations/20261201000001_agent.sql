-- Server-side assistant: one thread per counselor per student (plus a general
-- thread), message history with token counts, and pending proposals that the
-- counselor approves in Approvals. Inserts are service-role only.

create table public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  counselor_id uuid not null references auth.users (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (counselor_id, student_id)
);

create index agent_threads_firm_idx on public.agent_threads (firm_id);
create index agent_threads_student_idx on public.agent_threads (student_id);

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.agent_threads (id) on delete cascade,
  firm_id uuid not null references public.firms (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content jsonb not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

create index agent_messages_thread_idx on public.agent_messages (thread_id, created_at);
create index agent_messages_firm_day_idx on public.agent_messages (firm_id, created_at)
  where role = 'assistant';

create table public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  thread_id uuid not null references public.agent_threads (id) on delete cascade,
  kind text not null check (kind in ('message', 'parent_update', 'task', 'profile_change', 'meeting_times')),
  payload jsonb not null,
  rationale text not null default '',
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'discarded')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index agent_proposals_firm_status_idx on public.agent_proposals (firm_id, status, created_at desc);
create index agent_proposals_student_idx on public.agent_proposals (student_id);

alter table public.agent_threads enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_proposals enable row level security;

create policy agent_threads_select on public.agent_threads
  for select to authenticated using (public.is_firm_member(firm_id));

create policy agent_messages_select on public.agent_messages
  for select to authenticated using (public.is_firm_member(firm_id));

create policy agent_proposals_select on public.agent_proposals
  for select to authenticated using (public.is_firm_member(firm_id));

-- Counselors edit pending payloads and mark approved/discarded from the app.
create policy agent_proposals_update on public.agent_proposals
  for update to authenticated using (public.is_firm_member(firm_id))
  with check (public.is_firm_member(firm_id));

revoke all on table public.agent_threads from public, anon;
revoke all on table public.agent_messages from public, anon;
revoke all on table public.agent_proposals from public, anon;

grant select on table public.agent_threads to authenticated;
grant select on table public.agent_messages to authenticated;
grant select, update on table public.agent_proposals to authenticated;

grant all on table public.agent_threads to service_role;
grant all on table public.agent_messages to service_role;
grant all on table public.agent_proposals to service_role;
