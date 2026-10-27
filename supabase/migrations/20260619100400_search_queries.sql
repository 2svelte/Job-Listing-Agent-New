create table if not exists public.search_queries (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  location text not null,
  last_run_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(query, location)
);

create index if not exists idx_search_queries_active_last_run
  on public.search_queries(is_active, last_run_at nulls first);

alter table public.search_queries enable row level security;

insert into public.search_queries (query, location) values
  ('Software Engineer', 'Sydney NSW'),
  ('Project Manager', 'Melbourne VIC'),
  ('Data Analyst', 'Brisbane QLD')
on conflict (query, location) do nothing;
