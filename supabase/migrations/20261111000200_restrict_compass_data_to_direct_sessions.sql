-- Tokens issued to AI clients by the Supabase OAuth server are ordinary user JWTs with a
-- `client_id` claim. Without this change, such a token could read or replace the whole
-- portfolio through the REST API. After it, only direct Compass sessions (no client_id)
-- reach compass_data; AI clients must go through the MCP server's narrow tools.
--
-- The browser app is unaffected: its session tokens have no client_id claim.

drop policy if exists "Owner can read"   on public.compass_data;
drop policy if exists "Owner can insert" on public.compass_data;
drop policy if exists "Owner can update" on public.compass_data;

create policy "Owner can read" on public.compass_data for select
  using (auth.uid() = user_id and (auth.jwt() ->> 'client_id') is null);
create policy "Owner can insert" on public.compass_data for insert
  with check (auth.uid() = user_id and (auth.jwt() ->> 'client_id') is null);
create policy "Owner can update" on public.compass_data for update
  using (auth.uid() = user_id and (auth.jwt() ->> 'client_id') is null)
  with check (auth.uid() = user_id and (auth.jwt() ->> 'client_id') is null);
