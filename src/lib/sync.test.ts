import { describe, expect, it } from 'vitest';
import { createSeedData } from '../data/seed';
import { logActivity } from './ops';
import { memoryStorage } from './storage';
import { clearMeta, deviceLabel, isPristineSeed, planSync, readMeta, sameData, stableStringify, writeMeta, type RemoteRow, type SyncMeta } from './sync';

const remote = (revision: number): RemoteRow => ({ data: {}, revision, updated_at: '2026-11-10T00:00:00Z' });
const meta = (revision: number | null, dirty: boolean): SyncMeta => ({ userId: 'u1', revision, dirty });

describe('planSync', () => {
  it('uploads when the cloud is empty', () => {
    expect(planSync(null, null, false)).toBe('upload-first');
    expect(planSync(meta(3, false), null, false)).toBe('upload-first');
  });
  it('asks before linking a device whose data differs from the cloud', () => {
    expect(planSync(null, remote(4), false)).toBe('first-link');
    expect(planSync(meta(null, true), remote(4), false)).toBe('first-link');
  });
  it('adopts silently when contents already match', () => {
    expect(planSync(null, remote(4), true)).toBe('adopt');
    expect(planSync(meta(2, true), remote(4), true)).toBe('adopt');
    expect(planSync(meta(4, true), remote(4), true)).toBe('adopt');
  });
  it('does nothing when in sync and clean', () => {
    expect(planSync(meta(4, false), remote(4), false)).toBe('noop');
  });
  it('pushes local edits made on top of the latest cloud revision', () => {
    expect(planSync(meta(4, true), remote(4), false)).toBe('push');
  });
  it('pulls when the cloud is newer and this device is clean', () => {
    expect(planSync(meta(4, false), remote(6), false)).toBe('pull');
  });
  it('reports a conflict when both sides changed', () => {
    expect(planSync(meta(4, true), remote(5), false)).toBe('conflict');
  });
});

describe('sync helpers', () => {
  it('compares data independent of key order (Postgres jsonb reorders keys)', () => {
    const a = createSeedData(new Date('2026-11-10T12:00:00Z'));
    const reordered = JSON.parse(stableStringify(a)); // sorted keys
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(a));
    expect(sameData(a, reordered)).toBe(true);
    expect(sameData(a, { ...a, projects: a.projects.slice(1) })).toBe(false);
  });
  it('recognises untouched seed data', () => {
    const d = createSeedData();
    expect(isPristineSeed(d)).toBe(true);
    expect(isPristineSeed(logActivity(d, { kind: 'note', text: 'hi' }))).toBe(false);
  });
  it('stores and clears sync metadata', () => {
    const kv = memoryStorage();
    expect(readMeta(kv)).toBeNull();
    writeMeta(kv, meta(7, true));
    expect(readMeta(kv)).toEqual(meta(7, true));
    clearMeta(kv);
    expect(readMeta(kv)).toBeNull();
    expect(readMeta(memoryStorage({ 'project-compass:sync': '{bad' }))).toBeNull();
  });
  it('labels devices', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36 Edg/130')).toBe('Windows · Edge');
  });
});
