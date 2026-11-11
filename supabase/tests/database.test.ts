import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSeedData } from '../../src/data/seed';
import type { AppData } from '../../src/data/types';
import { handleToolCall, type RpcClient } from '../../src/lib/agent/service';
import { recordEntry } from '../../src/lib/ops';
import { addUser, as, browser, createDb, MIGRATIONS, oauth, serviceRpc } from './pg';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const CLIENT = 'chatgpt-client';
const seed = () => createSeedData(new Date('2026-11-01T12:00:00Z'));

async function setup() {
  const db = await createDb();
  await addUser(db, U1);
  await addUser(db, U2);
  // Both users have synced from the browser once (revision 1).
  for (const u of [U1, U2])
    await as(db, 'authenticated', browser(u), (tx) => tx.query('insert into public.compass_data (user_id, data, revision, device) values ($1, $2::jsonb, 1, $3)', [u, JSON.stringify(seed()), 'Windows · Chrome']));
  return db;
}

const enableAi = (db: PGlite, user = U1, clients = [CLIENT]) =>
  as(db, 'authenticated', browser(user), (tx) =>
    tx.query('insert into public.compass_ai_settings (user_id, ai_access_enabled, allowed_client_ids) values ($1, true, $2)', [user, clients]),
  );

const row = async (db: PGlite, user = U1) =>
  (await db.query<{ data: AppData; revision: number }>('select data, revision from public.compass_data where user_id = $1', [user])).rows[0];

describe('migrations', () => {
  it('apply cleanly on a fresh project and are safe to re-run', async () => {
    const db = await createDb();
    for (const m of MIGRATIONS) await db.exec(m.sql);
    const t = await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
    expect(t.rows.map((r) => r.table_name)).toEqual(['compass_ai_settings', 'compass_backups', 'compass_data', 'compass_mcp_ops']);
  });

  it('do not modify existing portfolio data', async () => {
    const db = await createDb({ migrations: false });
    await addUser(db, U1);
    await db.exec(MIGRATIONS[0].sql);
    await db.query('insert into public.compass_data (user_id, data, revision) values ($1, $2::jsonb, 7)', [U1, JSON.stringify(seed())]);
    for (const m of MIGRATIONS.slice(1)) await db.exec(m.sql);
    const r = await row(db);
    expect(r.revision).toBe(7);
    expect(r.data.projects).toHaveLength(18);
  });
});

describe('row-level security', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await setup();
  });

  it('browser sessions keep full access to their own row only', async () => {
    const mine = await as(db, 'authenticated', browser(U1), (tx) => tx.query('select user_id from public.compass_data'));
    expect(mine.rows).toEqual([{ user_id: U1 }]);
    const upd = await as(db, 'authenticated', browser(U1), (tx) => tx.query('update public.compass_data set revision = revision + 1 where revision = 1'));
    expect(upd.affectedRows).toBe(1);
    expect((await row(db, U2)).revision).toBe(1);
  });

  it('OAuth (AI client) tokens cannot read or write compass_data directly', async () => {
    const read = await as(db, 'authenticated', oauth(U1), (tx) => tx.query('select * from public.compass_data'));
    expect(read.rows).toEqual([]);
    const upd = await as(db, 'authenticated', oauth(U1), (tx) => tx.query(`update public.compass_data set data = '{}'::jsonb`));
    expect(upd.affectedRows).toBe(0);
    await expect(
      as(db, 'authenticated', oauth(U2), async (tx) => {
        await tx.query('delete from public.compass_data where user_id = $1', [U2]);
        return tx.query(`insert into public.compass_data (user_id, data) values ($1, '{}'::jsonb)`, [U2]);
      }),
    ).rejects.toThrow(/row-level security|permission denied/);
    expect((await row(db)).data.projects).toHaveLength(18);
  });

  it('anon gets nothing', async () => {
    await expect(as(db, 'anon', {}, (tx) => tx.query('select * from public.compass_data'))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'anon', {}, (tx) => tx.query('select * from public.compass_ai_settings'))).rejects.toThrow(/permission denied/);
  });

  it('only the browser session can manage AI settings, and only its own', async () => {
    await enableAi(db);
    await expect(
      as(db, 'authenticated', oauth(U1), (tx) => tx.query(`update public.compass_ai_settings set allowed_client_ids = '{evil}' returning user_id`)),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      as(db, 'authenticated', oauth(U2), (tx) => tx.query(`insert into public.compass_ai_settings (user_id, ai_access_enabled) values ($1, true)`, [U2])),
    ).rejects.toThrow(/row-level security/);
    const others = await as(db, 'authenticated', browser(U2), (tx) => tx.query('select * from public.compass_ai_settings'));
    expect(others.rows).toEqual([]);
  });

  it('backups and the op log are read-only for the browser', async () => {
    await expect(
      as(db, 'authenticated', browser(U1), (tx) => tx.query(`insert into public.compass_backups (user_id, revision, data, reason) values ($1, 1, '{}', 'x')`, [U1])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, 'authenticated', browser(U1), (tx) => tx.query(`insert into public.compass_mcp_ops (op_id, user_id, tool, kind, outcome) values ('o', $1, 't', 'read', 'ok')`, [U1])),
    ).rejects.toThrow(/permission denied/);
  });

  it('server functions are not callable by app or AI tokens', async () => {
    for (const claims of [browser(U1), oauth(U1)])
      for (const sql of [
        `select public.compass_mcp_read('${U1}')`,
        `select public.compass_mcp_commit('${U1}', 1, '{}'::jsonb, 'op')`,
        `select public.compass_mcp_authorize('${U1}', 'c', 'read')`,
        `select public.compass_mcp_log('${U1}', 'o', 'c', 't', 'read', 'ok')`,
      ])
        await expect(as(db, 'authenticated', claims, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
  });
});

describe('server functions (service role)', () => {
  let db: PGlite;
  let rpc: RpcClient;
  beforeEach(async () => {
    db = await setup();
    rpc = serviceRpc(db);
  });

  it('commit is an atomic compare-and-set that backs up the previous document', async () => {
    const next = recordEntry(seed(), 'antech', 'note', 'agent note');
    const ok = await rpc.rpc('compass_mcp_commit', { p_user: U1, p_expected: 1, p_data: next, p_op_id: 'r:1', p_device: 'ChatGPT' });
    expect(ok.data).toEqual({ ok: true, revision: 2 });
    const stale = await rpc.rpc('compass_mcp_commit', { p_user: U1, p_expected: 1, p_data: seed(), p_op_id: 'r:2' });
    expect(stale.data).toEqual({ ok: false, reason: 'conflict' });
    const r = await row(db);
    expect(r.revision).toBe(2);
    expect(r.data.activity[0].text).toBe('agent note');
    const b = await db.query<{ revision: number; op_id: string; data: AppData }>('select revision, op_id, data from public.compass_backups');
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]).toMatchObject({ revision: 1, op_id: 'r:1' });
    expect(b.rows[0].data.activity[0].text).toBe('Portfolio seeded with initial snapshot');
    expect((await db.query<{ device: string }>('select device from public.compass_data where user_id = $1', [U1])).rows[0].device).toBe('ChatGPT');
  });

  it('keeps only the 30 most recent backups', async () => {
    let d = seed();
    for (let i = 1; i <= 35; i++) {
      d = recordEntry(d, undefined, 'note', `n${i}`);
      const r = await rpc.rpc('compass_mcp_commit', { p_user: U1, p_expected: i, p_data: d, p_op_id: `r:${i}` });
      expect(r.data).toMatchObject({ ok: true });
    }
    const b = await db.query<{ n: number; min: number }>('select count(*)::int as n, min(revision)::int as min from public.compass_backups where user_id = $1', [U1]);
    expect(b.rows[0]).toEqual({ n: 30, min: 6 });
  });

  it('rejects documents that are not JSON objects', async () => {
    const r = await rpc.rpc('compass_mcp_commit', { p_user: U1, p_expected: 1, p_data: [1, 2], p_op_id: 'x' });
    expect(r.error?.message).toMatch(/invalid document/);
  });

  it('authorize: off by default, needs an approved client, rate-limits', async () => {
    const auth = (client = CLIENT, kind = 'read') => rpc.rpc('compass_mcp_authorize', { p_user: U1, p_client: client, p_kind: kind }).then((r) => r.data);
    expect(await auth()).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    await enableAi(db);
    expect(await auth()).toEqual({ ok: true });
    expect(await auth('someone-else')).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    for (let i = 0; i < 20; i++) await rpc.rpc('compass_mcp_log', { p_user: U1, p_op_id: `w${i}`, p_client: CLIENT, p_tool: 'add_activity', p_kind: 'write', p_outcome: 'ok' });
    expect(await auth(CLIENT, 'write')).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect(await auth(CLIENT, 'read')).toEqual({ ok: true });
    for (let i = 0; i < 40; i++) await rpc.rpc('compass_mcp_log', { p_user: U1, p_op_id: `r${i}`, p_client: CLIENT, p_tool: 'list_projects', p_kind: 'read', p_outcome: 'ok' });
    expect(await auth(CLIENT, 'read')).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    // Old entries don't count.
    await db.exec(`update public.compass_mcp_ops set created_at = now() - interval '2 minutes'`);
    expect(await auth(CLIENT, 'write')).toEqual({ ok: true });
  });
});

describe('data service end to end (handleToolCall → SQL)', () => {
  const caller = { userId: U1, clientId: CLIENT, agent: 'ChatGPT' };
  const NOW = new Date('2026-11-11T15:00:00Z');
  let db: PGlite;
  beforeEach(async () => {
    db = await setup();
  });

  it('refuses and logs when AI access is off', async () => {
    const r = await handleToolCall(serviceRpc(db), caller, 'add_activity', { text: 'hello' }, { now: NOW });
    expect(r).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect((await row(db)).revision).toBe(1);
    const ops = await db.query('select tool, outcome from public.compass_mcp_ops');
    expect(ops.rows).toEqual([{ tool: 'add_activity', outcome: 'forbidden' }]);
  });

  it('writes an attributed change, backs up, logs, and the browser sees it', async () => {
    await enableAi(db);
    const r = await handleToolCall(serviceRpc(db), caller, 'add_activity', { project: 'Antech', text: 'WordPress updates' }, { now: NOW });
    expect(r).toMatchObject({ ok: true, revision: 2 });

    // What the browser pulls (direct session).
    const pulled = await as(db, 'authenticated', browser(U1), (tx) => tx.query<{ data: AppData; revision: number }>('select data, revision from public.compass_data'));
    const entry = pulled.rows[0].data.activity[0];
    expect(pulled.rows[0].revision).toBe(2);
    expect(entry).toMatchObject({ text: 'WordPress updates', projectId: 'antech', source: { type: 'agent', agent: 'ChatGPT', clientId: CLIENT } });

    expect((await db.query('select count(*)::int as n from public.compass_backups')).rows[0]).toEqual({ n: 1 });
    const ops = await db.query('select tool, kind, outcome, revision_after::int as rev, client_id from public.compass_mcp_ops');
    expect(ops.rows).toEqual([{ tool: 'add_activity', kind: 'write', outcome: 'ok', rev: 2, client_id: CLIENT }]);

    // Repeat → duplicate, no new revision.
    const again = await handleToolCall(serviceRpc(db), caller, 'add_activity', { project: 'Antech', text: 'WordPress updates' }, { now: new Date(NOW.getTime() + 60_000) });
    expect(again).toMatchObject({ ok: true, duplicate: true, revision: 2 });
  });

  it('rebases over a browser save that lands mid-request', async () => {
    await enableAi(db);
    const base = serviceRpc(db);
    let raced = false;
    const racing: RpcClient = {
      async rpc(fn, args) {
        if (fn === 'compass_mcp_commit' && !raced) {
          raced = true;
          // The browser pushes an edit exactly like updateRemote() does.
          const cur = await row(db);
          const edited = recordEntry(cur.data, 'mindjax', 'note', 'typed in the browser');
          await as(db, 'authenticated', browser(U1), (tx) =>
            tx.query('update public.compass_data set data = $1::jsonb, revision = $2 where user_id = $3 and revision = $4', [JSON.stringify(edited), cur.revision + 1, U1, cur.revision]),
          );
        }
        return base.rpc(fn, args);
      },
    };
    const r = await handleToolCall(racing, caller, 'create_task', { project: 'oneshotz', title: 'Draft vendor schema' }, { now: NOW });
    expect(r).toMatchObject({ ok: true, revision: 3, attempts: 2 });
    const final = await row(db);
    expect(final.data.activity.map((e) => e.text)).toEqual(expect.arrayContaining(['typed in the browser', 'Added task: Draft vendor schema']));
    expect(final.data.projects.find((p) => p.id === 'oneshotz')!.tasks.some((t) => t.title === 'Draft vendor schema')).toBe(true);
  });

  it('uses the time zone stored in settings', async () => {
    await enableAi(db);
    const d = seed();
    d.settings.timeZone = 'America/Edmonton';
    await db.query('update public.compass_data set data = $1::jsonb where user_id = $2', [JSON.stringify(d), U1]);
    // 03:00 UTC Monday = Sunday evening in Edmonton → previous week.
    const r = await handleToolCall(serviceRpc(db), caller, 'get_week_plan', {}, { now: new Date('2026-11-09T03:00:00Z') });
    expect(r).toMatchObject({ ok: true, result: { weekStart: '2026-11-02' } });
  });

  it('never lets one user reach another user’s data', async () => {
    await enableAi(db, U2);
    await handleToolCall(serviceRpc(db), { ...caller, userId: U2 }, 'add_activity', { text: 'U2 note' }, { now: NOW });
    expect((await row(db, U1)).data.activity.some((e) => e.text === 'U2 note')).toBe(false);
    expect((await row(db, U2)).data.activity[0].text).toBe('U2 note');
  });
});
