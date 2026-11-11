// Test harness: an in-memory Postgres (PGlite) set up like a Supabase project — the anon /
// authenticated / service_role roles, default grants, and auth.uid()/auth.jwt() reading
// `request.jwt.claims` — with the repo's migrations applied. No Docker, no network.

import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { RpcClient } from '../../src/lib/agent/service';

const migrations = import.meta.glob('../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const MIGRATIONS = Object.entries(migrations)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, sql]) => ({ file, sql }));

const SUPABASE_EMULATION = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase's defaults: new tables/functions are granted to every API role.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function createDb(opts: { migrations?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_EMULATION);
  if (opts.migrations !== false) for (const m of MIGRATIONS) await db.exec(m.sql);
  return db;
}

export type Claims = Record<string, unknown>;

/** Run `fn` as an API role with the given JWT claims (like a PostgREST request). */
export async function as<T>(db: PGlite, role: 'anon' | 'authenticated' | 'service_role', claims: Claims, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    return fn(tx);
  });
}

export const browser = (sub: string): Claims => ({ sub, role: 'authenticated', aud: 'authenticated' });
export const oauth = (sub: string, clientId = 'chatgpt-client'): Claims => ({ ...browser(sub), client_id: clientId });

export async function addUser(db: PGlite, id: string) {
  await db.query('insert into auth.users (id) values ($1)', [id]);
}

/** RpcClient that calls public functions as service_role, like supabase-js with the service key. */
export function serviceRpc(db: PGlite): RpcClient {
  return {
    async rpc(fn, args = {}) {
      if (!/^[a-z_]+$/.test(fn)) return { data: null, error: { message: 'bad function name' } };
      const names = Object.keys(args);
      const values = names.map((k) => {
        const v = args[k];
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      });
      const params = names.map((k, i) => `${k} => $${i + 1}${args[k] !== null && typeof args[k] === 'object' ? '::jsonb' : ''}`).join(', ');
      try {
        return await as(db, 'service_role', { role: 'service_role' }, async (tx) => {
          if (fn === 'compass_mcp_read') {
            const r = await tx.query(`select * from public.${fn}(${params})`, values);
            return { data: r.rows, error: null };
          }
          const r = await tx.query<{ result: unknown }>(`select public.${fn}(${params}) as result`, values);
          return { data: r.rows[0]?.result ?? null, error: null };
        });
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  };
}
