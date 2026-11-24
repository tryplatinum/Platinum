-- The college directory: public figures about U.S. colleges, from the
-- Department of Education's College Scorecard, shared by every firm.
--
--   * college_directory     one row per institution, keyed by the federal UNITID
--   * college_programs      the bachelor's programs each one offers, by CIP code
--   * colleges (extended)   a student's list row can link to a directory row
--
-- Both new tables are read-only to signed-in people and closed to anon. Only
-- the import script (scripts/import-colleges.ts, service role) writes them.
-- They are not firm data, so they are not part of apply_changes.
--
-- A missing figure is null, never 0.

create extension if not exists pg_trgm with schema extensions;

create table public.college_directory (
  unitid integer primary key,
  name text not null check (btrim(name) <> ''),
  aliases text[] not null default '{}',
  -- Lower-cased name and aliases in one string, for type-ahead search. Written by the import.
  search_text text not null default '',
  city text,
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  region text check (region in (
    'New England', 'Mid East', 'Great Lakes', 'Plains', 'Southeast', 'Southwest',
    'Rocky Mountains', 'Far West', 'Outlying Areas', 'U.S. Service Schools')),
  lat double precision,
  lon double precision,
  url text,
  control text check (control in ('public', 'private_nonprofit', 'private_for_profit')),
  level text check (level in ('4-year', '2-year', 'less-than-2-year')),
  -- The Scorecard's label, for example "City: Large".
  locale text,
  undergrad_size integer check (undergrad_size >= 0),
  admit_rate numeric check (admit_rate between 0 and 1),
  sat_ebrw_25 integer check (sat_ebrw_25 between 200 and 800),
  sat_ebrw_50 integer check (sat_ebrw_50 between 200 and 800),
  sat_ebrw_75 integer check (sat_ebrw_75 between 200 and 800),
  sat_math_25 integer check (sat_math_25 between 200 and 800),
  sat_math_50 integer check (sat_math_50 between 200 and 800),
  sat_math_75 integer check (sat_math_75 between 200 and 800),
  act_25 integer check (act_25 between 1 and 36),
  act_50 integer check (act_50 between 1 and 36),
  act_75 integer check (act_75 between 1 and 36),
  -- The Scorecard has no field for these two. Null until another source is chosen.
  pct_submitting_sat numeric check (pct_submitting_sat between 0 and 1),
  pct_submitting_act numeric check (pct_submitting_act between 0 and 1),
  -- From the Scorecard's test requirement code, kept beside it as reported:
  --   1 Required -> required; 2 Recommended, 5 Considered but not required -> optional;
  --   3 Neither required nor recommended -> not_required; 4 Do not know -> unknown.
  -- 'blind' is allowed but the import never sets it: the Scorecard does not say
  -- whether scores are ignored.
  test_policy text check (test_policy in ('required', 'optional', 'not_required', 'blind', 'unknown')),
  test_policy_code smallint,
  tuition_in_state integer check (tuition_in_state >= 0),
  tuition_out_of_state integer check (tuition_out_of_state >= 0),
  avg_net_price integer,
  completion_rate numeric check (completion_rate between 0 and 1),
  median_earnings integer check (median_earnings >= 0),
  open_admissions boolean,
  -- False once an institution is no longer in the source. Rows are never deleted.
  is_active boolean not null default true,
  -- For each group of fields (admissions, tests, cost, outcomes, ...): {"source": "...", "year": "..."}.
  sources jsonb not null default '{}' check (jsonb_typeof(sources) = 'object'),
  imported_at timestamptz not null default now()
);

create table public.college_programs (
  unitid integer not null references public.college_directory (unitid) on delete cascade,
  -- Four-digit CIP code as the Scorecard gives it, for example "1107".
  cip_code text not null check (cip_code ~ '^[0-9]{4}$'),
  cip_title text not null,
  -- 3 = bachelor's degree. Only bachelor's programs are kept.
  credential_level smallint not null default 3 check (credential_level = 3),
  primary key (unitid, cip_code, credential_level)
);

create index college_directory_name_trgm_idx on public.college_directory using gin (name extensions.gin_trgm_ops);
create index college_directory_search_trgm_idx on public.college_directory using gin (search_text extensions.gin_trgm_ops);
create index college_directory_state_idx on public.college_directory (state);
create index college_directory_admit_rate_idx on public.college_directory (admit_rate);
create index college_directory_size_idx on public.college_directory (undergrad_size);
create index college_programs_cip_idx on public.college_programs (cip_code);

-- Public data: any signed-in person may read every row. There are no insert,
-- update or delete policies and no such privileges, so only the service role writes.
alter table public.college_directory enable row level security;
alter table public.college_programs enable row level security;
create policy college_directory_select on public.college_directory for select to authenticated using (true);
create policy college_programs_select on public.college_programs for select to authenticated using (true);

revoke all on table public.college_directory from public, anon, authenticated;
revoke all on table public.college_programs from public, anon, authenticated;
grant select on table public.college_directory to authenticated;
grant select on table public.college_programs to authenticated;
grant all on table public.college_directory to service_role;
grant all on table public.college_programs to service_role;

-- ── A student's list ────────────────────────────────────────────────────────
-- A row with no directory link works exactly as before. A college added from
-- the directory or from a draft has no plan or deadline yet, so both may be empty.

alter table public.colleges
  add column directory_unitid integer references public.college_directory (unitid) on delete set null,
  -- Why the row has the band it has, in words. Null on rows banded by hand before this.
  add column fit_reason text check (fit_reason is null or char_length(fit_reason) <= 500),
  add column fit_set_by text check (fit_set_by in ('rule', 'counselor'));

alter table public.colleges alter column plan drop not null;
alter table public.colleges alter column deadline drop not null;

create index colleges_directory_idx on public.colleges (directory_unitid) where directory_unitid is not null;
