-- Ensure pgcrypto
create extension if not exists pgcrypto;

-- Ensure the private bucket exists
insert into storage.buckets (id, name, public)
values ('bids','bids', false)
on conflict (id) do nothing;

-- Drop prior policies if they exist
do $$
begin
  begin drop policy if exists "bids_upload_own" on storage.objects; exception when undefined_object then null; end;
  begin drop policy if exists "bids_read_own"   on storage.objects; exception when undefined_object then null; end;
  begin drop policy if exists "bids_delete_none" on storage.objects; exception when undefined_object then null; end;
end$$;

-- INSERT (upload) — only to 'bids' and only into caller’s UID prefix
create policy "bids_upload_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'bids'
  and split_part(name, '/', 1) = auth.uid()::text
);

-- SELECT (read) — only within 'bids' and only caller’s UID prefix
create policy "bids_read_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'bids'
  and split_part(name, '/', 1) = auth.uid()::text
);

-- DELETE — deny for authenticated (no WITH CHECK on DELETE)
create policy "bids_delete_none"
on storage.objects
for delete
to authenticated
using (false);