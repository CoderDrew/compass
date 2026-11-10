-- Project Compass cloud sync schema.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
--
-- One row per user holds the whole portfolio as JSON (the same shape as an export file).
-- `revision` increases by one on every save so devices can detect conflicting edits.

create table if not exists public.compass_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null,
  revision   bigint      not null default 1,
  device     text,
  updated_at timestamptz not null default now()
);

-- Only the signed-in owner can ever see or change their row.
alter table public.compass_data enable row level security;

drop policy if exists "Owner can read"   on public.compass_data;
drop policy if exists "Owner can insert" on public.compass_data;
drop policy if exists "Owner can update" on public.compass_data;

create policy "Owner can read"   on public.compass_data for select using (auth.uid() = user_id);
create policy "Owner can insert" on public.compass_data for insert with check (auth.uid() = user_id);
create policy "Owner can update" on public.compass_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- No delete policy: the app never deletes your cloud copy.
