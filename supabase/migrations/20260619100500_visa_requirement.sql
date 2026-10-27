alter table public.jobs
  add column if not exists visa_requirement text not null default 'unknown'
    check (visa_requirement in ('restricted', 'open', 'unknown')),
  add column if not exists visa_needs_review boolean not null default false,
  add column if not exists visa_classified_by text
    check (visa_classified_by in ('rules', 'ai'));

create index if not exists idx_jobs_visa_requirement on public.jobs(visa_requirement);
create index if not exists idx_jobs_visa_needs_review on public.jobs(visa_needs_review) where visa_needs_review;

alter table public.job_preferences
  add column if not exists exclude_visa_restricted boolean not null default false;
