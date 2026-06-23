create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  preferred_titles text[] not null default '{}',
  preferred_job_types text[] not null default '{}',
  preferred_locations text[] not null default '{}',
  preferred_remote_types text[] not null default '{}',
  min_salary integer,
  max_salary integer,
  preferred_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_job_id text not null,
  source_url text not null,
  title text not null,
  company_name text not null,
  description text,
  location text,
  remote_type text,
  employment_type text,
  salary_min integer,
  salary_max integer,
  currency text not null default 'USD',
  tags text[] not null default '{}',
  category text,
  posted_at timestamptz,
  last_synced_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source, source_job_id),
  unique(source_url)
);

create table if not exists public.job_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  interaction_type text not null check (interaction_type in ('viewed', 'saved', 'applied', 'liked', 'disliked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, job_id, interaction_type)
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  score numeric(5,4) not null,
  reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(user_id, job_id)
);

create index if not exists idx_jobs_posted_at on public.jobs(posted_at desc);
create index if not exists idx_jobs_active on public.jobs(is_active);
create index if not exists idx_jobs_remote_type on public.jobs(remote_type);
create index if not exists idx_jobs_employment_type on public.jobs(employment_type);
create index if not exists idx_job_interactions_user_id on public.job_interactions(user_id);
create index if not exists idx_job_interactions_job_id on public.job_interactions(job_id);
create index if not exists idx_recommendations_user_id_score on public.recommendations(user_id, score desc);

alter table public.profiles enable row level security;
alter table public.job_preferences enable row level security;
alter table public.jobs enable row level security;
alter table public.job_interactions enable row level security;
alter table public.recommendations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'Users can read own profile'
  ) then
    create policy "Users can read own profile"
      on public.profiles
      for select
      using (auth.uid() = id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'Users can insert own profile'
  ) then
    create policy "Users can insert own profile"
      on public.profiles
      for insert
      with check (auth.uid() = id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'Users can update own profile'
  ) then
    create policy "Users can update own profile"
      on public.profiles
      for update
      using (auth.uid() = id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'job_preferences' and policyname = 'Users can read own preferences'
  ) then
    create policy "Users can read own preferences"
      on public.job_preferences
      for select
      using (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'job_preferences' and policyname = 'Users can upsert own preferences'
  ) then
    create policy "Users can upsert own preferences"
      on public.job_preferences
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'jobs' and policyname = 'Authenticated users can read jobs'
  ) then
    create policy "Authenticated users can read jobs"
      on public.jobs
      for select
      using (auth.role() = 'authenticated');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'job_interactions' and policyname = 'Users can read own interactions'
  ) then
    create policy "Users can read own interactions"
      on public.job_interactions
      for select
      using (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'job_interactions' and policyname = 'Users can write own interactions'
  ) then
    create policy "Users can write own interactions"
      on public.job_interactions
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'recommendations' and policyname = 'Users can read own recommendations'
  ) then
    create policy "Users can read own recommendations"
      on public.recommendations
      for select
      using (auth.uid() = user_id);
  end if;
end
$$;
