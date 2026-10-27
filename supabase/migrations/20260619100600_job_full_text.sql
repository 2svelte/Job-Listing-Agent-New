alter table public.jobs
  add column if not exists full_description text,
  add column if not exists full_text_status text
    check (full_text_status in ('fetched', 'failed')),
  add column if not exists full_text_fetched_at timestamptz;

create index if not exists idx_jobs_full_text_pending
  on public.jobs(created_at)
  where full_text_status is null and visa_requirement = 'unknown';
