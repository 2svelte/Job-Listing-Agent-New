alter table public.profiles
  add column if not exists is_admin boolean not null default false;
create index if not exists idx_profiles_is_admin
  on public.profiles(is_admin);
