-- The rule on sent reports was stricter than the product's rule. What must
-- hold: a report the AI drafted cannot be marked sent without a recorded
-- approval. A report the counselor wrote by hand (no `source`) has nothing to
-- approve; the sample caseload and data from before accounts contain those.

alter table public.reports drop constraint reports_check;
alter table public.reports add constraint reports_ai_needs_approval
  check (status = 'draft' or source is null or approval is not null);
