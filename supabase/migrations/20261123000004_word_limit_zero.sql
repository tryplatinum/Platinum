-- An essay with no word limit is stored as 0 by the app (the sample caseload
-- has one), so the check must allow it.

alter table public.documents drop constraint documents_word_limit_check;
alter table public.documents add constraint documents_word_limit_check check (word_limit >= 0);
