// Pure cloud-sync decisions. No network or React here, so it can be unit-tested.
//
// Model: this browser's localStorage copy is always the working copy. The cloud holds one
// row per user with a `revision` counter. Each device remembers the revision it last
// synced (`SyncMeta.revision`) and whether it has unsynced local edits (`dirty`).

import type { AppData } from '../data/types.ts';
import type { KV } from './storage.ts';

export const SYNC_META_KEY = 'project-compass:sync';

export interface SyncMeta {
  userId: string;
  /** Cloud revision this device last pulled or pushed. null = never synced on this device. */
  revision: number | null;
  /** Local edits not yet pushed. */
  dirty: boolean;
  lastSyncedAt?: string;
}

export interface RemoteRow {
  data: unknown;
  revision: number;
  updated_at: string;
  device?: string | null;
}

export type SyncPlan =
  | 'noop' // already in sync
  | 'adopt' // contents identical; just record the cloud revision
  | 'pull' // cloud is newer and this device has no unsynced edits
  | 'push' // this device has edits on top of the latest cloud revision
  | 'upload-first' // nothing in the cloud yet
  | 'first-link' // this device has never synced and differs from the cloud: ask
  | 'conflict'; // both this device and the cloud changed since the last sync: ask

export function planSync(meta: SyncMeta | null, remote: RemoteRow | null, sameContent: boolean): SyncPlan {
  if (!remote) return 'upload-first';
  if (!meta || meta.revision === null) return sameContent ? 'adopt' : 'first-link';
  if (remote.revision === meta.revision) return meta.dirty && !sameContent ? 'push' : meta.dirty ? 'adopt' : 'noop';
  if (sameContent) return 'adopt';
  return meta.dirty ? 'conflict' : 'pull';
}

/** True for a browser that only has the untouched seed dataset (safe to replace without asking). */
export function isPristineSeed(d: AppData): boolean {
  return d.activity.length === 1 && d.activity[0].kind === 'project' && d.activity[0].text === 'Portfolio seeded with initial snapshot';
}

/** JSON with sorted keys, so data that round-tripped through Postgres jsonb compares equal. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export const sameData = (a: AppData, b: AppData) => stableStringify(a) === stableStringify(b);

export function readMeta(kv: KV): SyncMeta | null {
  try {
    const raw = kv.getItem(SYNC_META_KEY);
    const m = raw ? JSON.parse(raw) : null;
    return m && typeof m.userId === 'string' ? (m as SyncMeta) : null;
  } catch {
    return null;
  }
}

export function writeMeta(kv: KV, meta: SyncMeta): void {
  kv.setItem(SYNC_META_KEY, JSON.stringify(meta));
}

export function clearMeta(kv: KV): void {
  kv.removeItem(SYNC_META_KEY);
}

/** Short, human label for "last saved from …". */
export function deviceLabel(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${browser}`;
}
