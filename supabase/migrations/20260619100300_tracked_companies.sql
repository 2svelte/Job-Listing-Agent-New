create table if not exists public.tracked_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ats_provider text not null check (ats_provider in ('greenhouse', 'lever', 'ashby')),
  board_token text not null,
  last_synced_at timestamptz,
  last_error text,
  needs_verification boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(ats_provider, board_token)
);

create index if not exists idx_tracked_companies_active_synced
  on public.tracked_companies(is_active, last_synced_at nulls first);

alter table public.tracked_companies enable row level security;
