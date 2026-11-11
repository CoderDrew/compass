-- AI integration (MCP) data service.
--
-- Adds, without touching existing data:
--   compass_ai_settings  per-user switch + approved OAuth clients (managed from the browser)
--   compass_backups      copy of the document before every agent write (last 30 kept)
--   compass_mcp_ops      operational log: rate limiting + troubleshooting (no document content)
--   compass_mcp_*()      the only way agent requests reach the data. SECURITY DEFINER,
--                        executable by service_role only (i.e. the MCP Edge Function).
--
-- "Direct session" below means a normal Supabase session from the Compass app. OAuth tokens
-- issued to AI clients carry a `client_id` claim and are refused by every policy here.

-- ── Settings ──────────────────────────────────────────────────────────────

create table if not exists public.compass_ai_settings (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  ai_access_enabled  boolean     not null default false,
  allowed_client_ids text[]      not null default '{}',
  -- Display names of approved clients, {"<client_id>": "Claude"}; used for attribution.
  client_names       jsonb       not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);

alter table public.compass_ai_settings enable row level security;

drop policy if exists "Owner (direct session) can read"   on public.compass_ai_settings;
drop policy if exists "Owner (direct session) can insert" on public.compass_ai_settings;
drop policy if exists "Owner (direct session) can update" on public.compass_ai_settings;

create policy "Owner (direct session) can read" on public.compass_ai_settings for select
  using (auth.uid() = user_id and (auth.jwt() ->> 'client_id') is null);
create policy "Owner (direct session) can insert" on public.compass_ai_settings for insert
  with check (auth.uid() = user_id and (auth.jwt() ->> 'client_id') is null);
create policy "Owner (direct session) can update" on public.compass_ai_settings for update
  using (auth.uid() = user_id and (auth.jwt() ->> 'client_id') is null)
  with check (auth.uid() = user_id and (auth.jwt() ->> 'client_id') is null);

revoke all on public.compass_ai_settings from anon, authenticated;
grant select, insert, update on public.compass_ai_settings to authenticated;

-- ── Backups ───────────────────────────────────────────────────────────────

create table if not exists public.compass_backups (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  revision   bigint      not null,
  data       jsonb       not null,
  reason     text        not null,
  op_id      text,
  created_at timestamptz not null default now()
);
create index if not exists compass_backups_user_time on public.compass_backups (user_id, created_at desc);

alter table public.compass_backups enable row level security;
drop policy if exists "Owner (direct session) can read" on public.compass_backups;
create policy "Owner (direct session) can read" on public.compass_backups for select
  using (auth.uid() = user_id and (auth.jwt() ->> 'client_id') is null);
revoke all on public.compass_backups from anon, authenticated;
grant select on public.compass_backups to authenticated;

-- ── Operation log ─────────────────────────────────────────────────────────

create table if not exists public.compass_mcp_ops (
  id              bigint generated always as identity primary key,
  op_id           text        not null,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  client_id       text,
  tool            text        not null,
  kind            text        not null check (kind in ('read', 'write')),
  outcome         text        not null check (outcome in ('ok', 'duplicate', 'error', 'rate_limited', 'forbidden')),
  error_code      text,
  revision_before bigint,
  revision_after  bigint,
  duration_ms     integer,
  created_at      timestamptz not null default now()
);
create index if not exists compass_mcp_ops_user_time on public.compass_mcp_ops (user_id, created_at desc);

alter table public.compass_mcp_ops enable row level security;
drop policy if exists "Owner (direct session) can read" on public.compass_mcp_ops;
create policy "Owner (direct session) can read" on public.compass_mcp_ops for select
  using (auth.uid() = user_id and (auth.jwt() ->> 'client_id') is null);
revoke all on public.compass_mcp_ops from anon, authenticated;
grant select on public.compass_mcp_ops to authenticated;

-- ── Server-only functions ─────────────────────────────────────────────────

-- Is this user/client allowed right now, and within rate limits?
-- Returns {"ok": true, "agent": "<display name>"} or {"ok": false, "code": "FORBIDDEN" | "RATE_LIMITED", "retry_after": n}.
create or replace function public.compass_mcp_authorize(p_user uuid, p_client text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.compass_ai_settings%rowtype;
  n_all integer;
  n_write integer;
begin
  select * into s from public.compass_ai_settings where user_id = p_user;
  if not found or not s.ai_access_enabled then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'AI access is turned off in Compass (Data & settings).');
  end if;
  if p_client is null or not (p_client = any (s.allowed_client_ids)) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'This app has not been approved in Compass.');
  end if;

  select count(*), count(*) filter (where kind = 'write')
    into n_all, n_write
    from public.compass_mcp_ops
   where user_id = p_user and created_at > now() - interval '60 seconds';
  if n_all >= 60 or (p_kind = 'write' and n_write >= 20) then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'retry_after', 60);
  end if;
  return jsonb_build_object('ok', true, 'agent', coalesce(nullif(s.client_names ->> p_client, ''), 'AI assistant'));
end;
$$;

-- Current document and revision (or no row).
create or replace function public.compass_mcp_read(p_user uuid)
returns table (data jsonb, revision bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select d.data, d.revision from public.compass_data d where d.user_id = p_user;
$$;

-- Atomic compare-and-set write. Backs up the previous document in the same transaction.
-- Returns {"ok": true, "revision": n} or {"ok": false, "reason": "conflict"}.
create or replace function public.compass_mcp_commit(
  p_user uuid,
  p_expected bigint,
  p_data jsonb,
  p_op_id text,
  p_device text default 'AI assistant'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_rev bigint;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 5000000 then
    raise exception 'compass_mcp_commit: invalid document' using errcode = '22023';
  end if;

  -- Lock the row only if it is still at the expected revision.
  select d.data into v_old
    from public.compass_data d
   where d.user_id = p_user and d.revision = p_expected
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'conflict');
  end if;

  insert into public.compass_backups (user_id, revision, data, reason, op_id)
  values (p_user, p_expected, v_old, 'before agent write', p_op_id);

  update public.compass_data
     set data = p_data, revision = p_expected + 1, device = left(p_device, 80), updated_at = now()
   where user_id = p_user and revision = p_expected
  returning revision into v_rev;

  -- Keep the 30 most recent backups per user.
  delete from public.compass_backups b
   where b.user_id = p_user
     and b.id not in (select id from public.compass_backups where user_id = p_user order by created_at desc, id desc limit 30);

  return jsonb_build_object('ok', true, 'revision', v_rev);
end;
$$;

-- Operational log entry (also feeds the rate limiter). Prunes entries older than 90 days.
create or replace function public.compass_mcp_log(
  p_user uuid,
  p_op_id text,
  p_client text,
  p_tool text,
  p_kind text,
  p_outcome text,
  p_error_code text default null,
  p_revision_before bigint default null,
  p_revision_after bigint default null,
  p_duration_ms integer default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.compass_mcp_ops (op_id, user_id, client_id, tool, kind, outcome, error_code, revision_before, revision_after, duration_ms)
  values (left(p_op_id, 100), p_user, left(p_client, 200), left(p_tool, 60), p_kind, p_outcome, left(p_error_code, 60), p_revision_before, p_revision_after, p_duration_ms);
  delete from public.compass_mcp_ops where user_id = p_user and created_at < now() - interval '90 days';
$$;

revoke all on function public.compass_mcp_authorize(uuid, text, text) from public, anon, authenticated;
revoke all on function public.compass_mcp_read(uuid) from public, anon, authenticated;
revoke all on function public.compass_mcp_commit(uuid, bigint, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.compass_mcp_log(uuid, text, text, text, text, text, text, bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.compass_mcp_authorize(uuid, text, text) to service_role;
grant execute on function public.compass_mcp_read(uuid) to service_role;
grant execute on function public.compass_mcp_commit(uuid, bigint, jsonb, text, text) to service_role;
grant execute on function public.compass_mcp_log(uuid, text, text, text, text, text, text, bigint, bigint, integer) to service_role;
