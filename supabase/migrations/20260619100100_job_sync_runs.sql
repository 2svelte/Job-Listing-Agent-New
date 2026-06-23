create table if not exists public.job_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null check (status in ('started', 'success', 'failed', 'skipped')),
  fetched_count integer not null default 0,
  upserted_count integer not null default 0,
  requested_pages integer,
  country text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists idx_job_sync_runs_source_started_at
  on public.job_sync_runs(source, started_at desc);
