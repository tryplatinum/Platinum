-- Which task a weekly text leads with: {title, reason, changedOrder}. Choosing
-- the most urgent task is the AI's one judgment in that feature; this keeps the
-- choice and its reason beside the draft so the counselor can check it.
-- apply_changes reads a table's columns when it runs, so it needs no change.
alter table public.weekly_texts add column lead jsonb;
