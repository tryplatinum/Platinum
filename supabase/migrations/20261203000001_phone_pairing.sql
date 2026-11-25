-- Phone pairing and finished job text.
--
-- A setup code is stored only as a hash, works once, and lasts ten minutes.
-- The device key expires. A finished job does not keep its text: that text can
-- hold a student link, and the phone already received it in the claim response.
-- The claim lease is ten minutes. After that the server puts the job back on
-- the queue (it does not stay claimed).

alter table public.phone_send_jobs alter column body drop not null;

-- CHECK (char_length(body) between 1 and 4000) allows null: a check passes when
-- its expression is null. Only a finished row is cleared.
update public.phone_send_jobs
set body = null
where status in ('submitted', 'failed', 'expired', 'cancelled');

alter table public.phone_devices add column key_expires_at timestamptz;

update public.phone_devices
set key_expires_at = created_at + interval '90 days'
where key_expires_at is null;

alter table public.phone_devices alter column key_expires_at set not null;

create table public.phone_setup_codes (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  counselor_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  -- The counselor already saw the notice when they asked for this code.
  notice_shown boolean not null default false,
  label text not null check (char_length(label) between 1 and 80),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index phone_setup_codes_counselor_idx on public.phone_setup_codes (counselor_id) where used_at is null;

alter table public.phone_setup_codes enable row level security;
revoke all on table public.phone_setup_codes from public, anon, authenticated;
grant all on table public.phone_setup_codes to service_role;

-- Same claim as before, with a ten-minute lease. The phone has that long to
-- report. A later report is rejected by the server, which returns the job to
-- pending so another claim can take it.
create or replace function public.claim_phone_send_job(device uuid)
returns setof public.phone_send_jobs
language sql
security invoker
set search_path = ''
as $$
  update public.phone_send_jobs
  set status = 'claimed',
      claim_id = gen_random_uuid(),
      claimed_at = now(),
      lease_expires_at = now() + interval '10 minutes'
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
