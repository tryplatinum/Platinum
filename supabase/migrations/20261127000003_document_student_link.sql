-- Which student link a file was dropped through.
--
-- Null on everything a counselor uploaded and on files dropped before this.
-- The link row is kept when a link is revoked, so the record survives that; if a
-- link row is ever deleted the file stays and this becomes null.
-- The daily cap is still counted per student, not per link.

alter table public.documents
  add column student_link_id uuid references public.student_links (id) on delete set null;

create index documents_student_link_idx on public.documents (student_link_id) where student_link_id is not null;
