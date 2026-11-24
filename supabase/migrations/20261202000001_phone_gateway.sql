-- Texts from a counselor's own iPhone.
--
-- An approved text is turned into a job for the approving counselor's phone.
-- An Apple Shortcut on the phone asks /api/phone for the job, sends it with
-- Messages, and reports back.
--
--   * phone_devices      one phone per counselor. Holds only the SHA-256 hash of
--                        the device key, never the key.
--   * phone_send_jobs    one job per outbox row (outbox_id is unique), with the
--                        exact final text and the number it goes to.
--   * phone_job_events   every change of a job's status. No message text.
--   * claim_phone_send_job(device)   hands the oldest waiting job to a phone, in
--                        one statement, so two calls at once cannot both get it.
--   * outbox.delivery_detail   says where a text handed to a phone stands, so
--                        the Messages screen can show it without a new status.
--
-- All three tables have row level security on with NO policy and no grant for
-- signed-in people: only the service role (the server) reads or writes them.
--
-- Additive only: new tables, one new nullable column, new indexes, one new
-- function. Nothing is dropped, renamed or replaced.

-- ── Phones ──────────────────────────────────────────────────────────────────

create table public.phone_devices (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  counselor_id uuid not null references auth.users (id) on delete cascade,
  -- Android is not built yet; it is allowed here so it can be added later.
  platform text not null default 'ios_shortcut' check (platform in ('ios_shortcut', 'android')),
  label text not null check (char_length(label) between 1 and 80),
  -- SHA-256 of the device key, as hex. The key itself is shown once and never stored.
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  -- Where the wake email goes: the counselor's own connected Gmail address.
  wake_email text not null check (char_length(wake_email) <= 320),
  -- The counselor's own number, for "Send a test to my own number".
  own_phone text check (own_phone is null or own_phone ~ '^\+[0-9]{7,15}$'),
  -- When the counselor was shown the notice about texting from their own number.
  notice_shown_at timestamptz,
  -- At most one wake email per phone per 20 seconds.
  last_wake_at timestamptz,
  created_at timestamptz not null default now(),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz
);

-- At most one phone in use per counselor.
create unique index phone_devices_one_active_idx on public.phone_devices (counselor_id) where revoked_at is null;
create index phone_devices_firm_idx on public.phone_devices (firm_id);

alter table public.phone_devices enable row level security;
revoke all on table public.phone_devices from public, anon, authenticated;
grant all on table public.phone_devices to service_role;

-- ── Jobs ────────────────────────────────────────────────────────────────────

create table public.phone_send_jobs (
  id uuid primary key default gen_random_uuid(),
  -- One outbox row can never produce two jobs. Null only for the counselor's own test text.
  outbox_id uuid unique references public.outbox (id) on delete cascade,
  device_id uuid not null references public.phone_devices (id) on delete cascade,
  to_phone text not null check (to_phone ~ '^\+[0-9]{7,15}$'),
  -- The exact final text, as the dispatcher built it.
  body text not null check (char_length(body) between 1 and 4000),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'submitted', 'failed', 'unknown', 'expired', 'cancelled')),
  claim_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  reported_at timestamptz,
  error text check (error is null or char_length(error) <= 300)
);

create index phone_send_jobs_waiting_idx on public.phone_send_jobs (device_id, created_at) where status = 'pending';
create index phone_send_jobs_device_idx on public.phone_send_jobs (device_id, created_at desc);

alter table public.phone_send_jobs enable row level security;
revoke all on table public.phone_send_jobs from public, anon, authenticated;
grant all on table public.phone_send_jobs to service_role;

-- ── What happened to each job ───────────────────────────────────────────────

create table public.phone_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.phone_send_jobs (id) on delete cascade,
  at timestamptz not null default now(),
  from_status text,
  to_status text not null,
  actor text not null check (actor in ('dispatcher', 'device', 'counselor', 'sweep')),
  actor_id uuid,
  -- True when a phone reported after its two minutes were up.
  late boolean not null default false
);

create index phone_job_events_job_idx on public.phone_job_events (job_id, at);

alter table public.phone_job_events enable row level security;
revoke all on table public.phone_job_events from public, anon, authenticated;
grant all on table public.phone_job_events to service_role;

-- ── Handing a job to a phone ────────────────────────────────────────────────

-- The oldest waiting job of one phone, claimed in ONE statement. "for update
-- skip locked" means two calls at the same moment take different rows, or one
-- of them takes nothing. A job is handed out once: nothing returns to pending.
create function public.claim_phone_send_job(device uuid)
returns setof public.phone_send_jobs
language sql
security invoker
set search_path = ''
as $$
  update public.phone_send_jobs
  set status = 'claimed',
      claim_id = gen_random_uuid(),
      claimed_at = now(),
      lease_expires_at = now() + interval '2 minutes'
  where id = (
    select j.id
    from public.phone_send_jobs j
    where j.device_id = claim_phone_send_job.device
      and j.status = 'pending'
      and j.expires_at > now()
    order by j.created_at
    limit 1
    for update skip locked
  )
  returning *;
$$;

revoke execute on function public.claim_phone_send_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_phone_send_job(uuid) to service_role;

-- ── Where a text handed to a phone stands ───────────────────────────────────

-- Null for every message that did not go to a phone. The outbox statuses are
-- unchanged: a text waiting for a phone stays 'sending' (so the dispatcher never
-- picks it up again), and this column says which kind of waiting it is.
alter table public.outbox
  add column delivery_detail text
    check (delivery_detail is null or delivery_detail in ('phone_waiting', 'phone_sent', 'phone_unknown', 'phone_expired', 'phone_failed', 'phone_none'));
