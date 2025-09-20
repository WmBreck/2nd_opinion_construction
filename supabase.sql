create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  email text not null,
  phone text not null,
  city text not null,
  zip text not null,
  reason text not null,
  status text not null default 'new',
  notes text
);

create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_size int not null,
  file_type text,
  created_at timestamptz default now()
);

insert into storage.buckets (id, name, public) values ('bids','bids', false)
on conflict (id) do nothing;

alter table public.leads enable row level security;
alter table public.uploads enable row level security;

create policy "allow insert leads" on public.leads for insert to anon with check (true);
create policy "block select leads" on public.leads for select to anon using (false);

create policy "allow insert uploads" on public.uploads for insert to anon with check (true);
create policy "block select uploads" on public.uploads for select to anon using (false);

create policy "allow uploads" on storage.objects
  for insert to anon
  with check (bucket_id = 'bids');

create policy "block read" on storage.objects
  for select to anon
  using (false);
