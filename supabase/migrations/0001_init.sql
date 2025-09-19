-- 0001_init.sql
-- Schema for 2nd Opinion Construction MVP

create extension if not exists "pgcrypto";

create table if not exists public.leads (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    user_id uuid references auth.users (id) on delete set null,
    name text not null,
    email text not null,
    phone text not null,
    city text,
    zip text,
    reason text not null,
    project_type text,
    budget_range text,
    status text not null default 'new',
    notes text,
    consent boolean not null default true
);

create table if not exists public.uploads (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    user_id uuid references auth.users (id) on delete set null,
    lead_id uuid not null references public.leads (id) on delete cascade,
    file_path text not null,
    file_name text not null,
    file_type text,
    file_size integer
);

create table if not exists public.responses (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    responder_id uuid references auth.users (id) on delete set null,
    lead_id uuid not null references public.leads (id) on delete cascade,
    body text not null,
    visibility text not null default 'client',
    sent_via text
);

comment on table public.leads is 'Incoming construction review requests from homeowners/GCs.';
comment on table public.uploads is 'Files associated with a lead submission.';
comment on table public.responses is 'Follow-up responses for a lead; service role only for now.';

-- Row Level Security
alter table public.leads enable row level security;
alter table public.uploads enable row level security;
alter table public.responses enable row level security;

-- Leads policies
drop policy if exists "leads_insert_own" on public.leads;
create policy "leads_insert_own" on public.leads
    for insert
    with check (auth.uid() = user_id);

drop policy if exists "leads_select_own" on public.leads;
create policy "leads_select_own" on public.leads
    for select
    using (auth.uid() = user_id);

-- Uploads policies
drop policy if exists "uploads_insert_own" on public.uploads;
create policy "uploads_insert_own" on public.uploads
    for insert
    with check (auth.uid() = user_id);

drop policy if exists "uploads_select_own" on public.uploads;
create policy "uploads_select_own" on public.uploads
    for select
    using (auth.uid() = user_id);

-- Responses: deny authenticated users (no explicit policies)

drop policy if exists "responses_block_all" on public.responses;
create policy "responses_block_all" on public.responses
    for all to authenticated
    using (false)
    with check (false);

-- Storage bucket
insert into storage.buckets (id, name, public)
values ('bids', 'bids', false)
on conflict (id) do nothing;

-- Storage policies for bids bucket
create or replace function public.storage_path_uid(name text)
returns text
language sql
stable
as $$
    select split_part(name, '/', 1);
$$;

drop policy if exists "bids_upload_own" on storage.objects;
create policy "bids_upload_own" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'bids'
        and storage_path_uid(name) = auth.uid()::text
    );

drop policy if exists "bids_read_own" on storage.objects;
create policy "bids_read_own" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'bids'
        and storage_path_uid(name) = auth.uid()::text
    );

drop policy if exists "bids_delete_none" on storage.objects;
create policy "bids_delete_none" on storage.objects
    for delete to authenticated
    using (false);
