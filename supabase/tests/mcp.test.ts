// End-to-end over the real MCP protocol: MCP client → Streamable HTTP → handler.ts (OAuth
// checks) → server.ts → shared command layer → SQL functions in PGlite.

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { PGlite } from '@electric-sql/pglite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeedData } from '../../src/data/seed';
import type { AppData } from '../../src/data/types';
import { createCompassHandler } from '../functions/compass-mcp/handler';
import { addUser, as, browser, createDb, serviceRpc } from './pg';

const U1 = '11111111-1111-4111-8111-111111111111';
const CLIENT = 'claude-client-id';
const ISSUER = 'https://example-ref.supabase.co/auth/v1';
const RESOURCE = 'https://example-ref.supabase.co/functions/v1/compass-mcp';
const NOW = new Date('2026-11-11T15:00:00Z');

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const kp = await generateKeyPair('ES256');
  privateKey = kp.privateKey;
  otherKey = (await generateKeyPair('ES256')).privateKey;
  const pub = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256' } as JWK;
  jwks = createLocalJWKSet({ keys: [pub] });
});

const token = (over: { sub?: string; client_id?: string | null; exp?: number; key?: CryptoKey; iss?: string } = {}) => {
  const claims: Record<string, unknown> = { role: 'authenticated', scope: 'email' };
  if (over.client_id !== null) claims.client_id = over.client_id ?? CLIENT;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject(over.sub ?? U1)
    .setIssuer(over.iss ?? ISSUER)
    .setAudience('authenticated')
    .setIssuedAt(Math.floor(NOW.getTime() / 1000) - 60)
    .setExpirationTime(over.exp ?? Math.floor(NOW.getTime() / 1000) + 3600)
    .sign(over.key ?? privateKey);
};

async function setupDb(enabled = true) {
  const db = await createDb();
  await addUser(db, U1);
  await as(db, 'authenticated', browser(U1), async (tx) => {
    await tx.query('insert into public.compass_data (user_id, data, revision) values ($1, $2::jsonb, 1)', [U1, JSON.stringify(createSeedData(new Date('2026-11-01T12:00:00Z')))]);
    await tx.query('insert into public.compass_ai_settings (user_id, ai_access_enabled, allowed_client_ids, client_names) values ($1, $2, $3, $4::jsonb)', [
      U1,
      enabled,
      [CLIENT],
      JSON.stringify({ [CLIENT]: 'Claude' }),
    ]);
  });
  return db;
}

const handlerFor = (db: PGlite) => createCompassHandler({ issuer: ISSUER, resourceUrl: RESOURCE, jwks, rpc: serviceRpc(db), now: () => NOW });

async function connect(handler: (r: Request) => Promise<Response>, bearer: string) {
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    fetch: (url, init) => handler(new Request(url, init)),
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

const dataOf = async (db: PGlite) => (await db.query<{ data: AppData; revision: number }>('select data, revision from public.compass_data where user_id = $1', [U1])).rows[0];

describe('HTTP + OAuth layer', () => {
  let handler: (r: Request) => Promise<Response>;
  beforeEach(async () => {
    handler = handlerFor(await setupDb());
  });

  it('publishes protected-resource metadata pointing at Supabase Auth', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/oauth-protected-resource']) {
      const res = await handler(new Request(RESOURCE + path));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ resource: RESOURCE, authorization_servers: [ISSUER], bearer_methods_supported: ['header'] });
    }
  });

  it('challenges unauthenticated requests per the MCP authorization spec', async () => {
    const res = await handler(new Request(RESOURCE, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${RESOURCE}/.well-known/oauth-protected-resource"`);
  });

  it('rejects forged, expired, wrong-issuer and non-OAuth tokens', async () => {
    const post = async (t: string) => handler(new Request(RESOURCE, { method: 'POST', body: '{}', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' } }));
    for (const bad of [await token({ key: otherKey }), await token({ exp: Math.floor(NOW.getTime() / 1000) - 10 }), await token({ iss: 'https://evil.example/auth/v1' }), 'not-a-jwt']) {
      const res = await post(bad);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
    }
    // A Compass browser session token (no client_id) is refused even though it's valid.
    expect((await post(await token({ client_id: null }))).status).toBe(403);
  });

  it('answers CORS preflight', async () => {
    const res = await handler(new Request(RESOURCE, { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
  });
});

describe('MCP protocol end to end', () => {
  let db: PGlite;
  let client: Client;
  beforeEach(async () => {
    db = await setupDb();
    client = await connect(handlerFor(db), await token());
  });

  it('lists the 13 tools with schemas and correct annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['add_activity', 'add_journal_summary', 'complete_milestone', 'create_milestone', 'create_task', 'get_activity', 'get_journal', 'get_project', 'get_week_plan', 'list_projects', 'update_project', 'update_task', 'update_week_plan'].sort(),
    );
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.list_projects.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(byName.create_task.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.create_task.inputSchema).toMatchObject({ type: 'object', required: ['project', 'title'], additionalProperties: false });
    expect(client.getInstructions()).toContain('Never invent dates');
  });

  it('reads and writes real data, attributed to the approved client name', async () => {
    const list = await client.callTool({ name: 'list_projects', arguments: { query: 'starfall' } });
    expect(list.isError).toBeFalsy();
    expect((list.structuredContent as { projects: { id: string }[] }).projects.map((p) => p.id).sort()).toEqual(['starfall', 'starfall-photos']);

    const write = await client.callTool({ name: 'complete_milestone', arguments: { project: 'Starfall', milestone: 'playtesting', request_id: 'r1' } });
    expect(write.isError).toBeFalsy();
    expect(write.structuredContent).toMatchObject({ ok: true, milestone: { title: 'Physical playtesting round', done: true } });

    const row = await dataOf(db);
    expect(row.revision).toBe(2);
    expect(row.data.activity[0]).toMatchObject({ kind: 'milestone', source: { type: 'agent', agent: 'Claude', clientId: CLIENT } });

    const again = await client.callTool({ name: 'complete_milestone', arguments: { project: 'Starfall', milestone: 'playtesting', request_id: 'r1' } });
    expect(again.structuredContent).toMatchObject({ ok: true, duplicate: true });
    expect((await dataOf(db)).revision).toBe(2);
  });

  it('returns structured, actionable errors as tool results', async () => {
    const amb = await client.callTool({ name: 'add_activity', arguments: { project: 'Harbor', text: 'x' } });
    expect(amb.isError).toBe(true);
    expect(amb.structuredContent).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_REFERENCE' } });

    const bad = await client.callTool({ name: 'update_project', arguments: { project: 'day-job', status: 'parked' } });
    expect(bad.structuredContent).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', details: ['status is not a recognised field'] } });
    expect((await dataOf(db)).revision).toBe(1);
  });

  it('respects the AI access switch immediately', async () => {
    await as(db, 'authenticated', browser(U1), (tx) => tx.query('update public.compass_ai_settings set ai_access_enabled = false'));
    const r = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('refuses a client that was never approved in Compass', async () => {
    const stranger = await connect(handlerFor(db), await token({ client_id: 'some-other-app' }));
    const r = await stranger.callTool({ name: 'get_week_plan', arguments: {} });
    expect(r.structuredContent).toMatchObject({ error: { code: 'FORBIDDEN', message: 'This app has not been approved in Compass.' } });
  });
});
