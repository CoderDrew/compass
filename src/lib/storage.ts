// Persistence, schema migration, validation, and JSON import/export.
// All functions accept an injectable Storage so they can be unit-tested.

import { createSeedData } from '../data/seed';
import { SCHEMA_VERSION, type AppData, type Project } from '../data/types';
import { isValidDue } from './dates';

export const STORAGE_KEY = 'project-compass:data';
export const BACKUP_KEY = 'project-compass:backup';

export type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STATUSES = ['active', 'maintain', 'review', 'waiting', 'parked', 'completed', 'archived'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const CATEGORIES = ['employment', 'business', 'software', 'creative', 'career', 'personal'];
const TASK_STATUSES = ['todo', 'doing', 'done'];

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations keyed by the version they upgrade FROM.
 * When the schema changes: bump SCHEMA_VERSION and add `[old]: (d) => ({...d, schemaVersion: old + 1, ...})`.
 */
const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: pre-release data without a version number.
  0: (d) => ({ ...d, schemaVersion: 1 }),
};

export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let data = { ...raw };
  let v = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
  if (v > SCHEMA_VERSION) {
    throw new Error(`This file was created by a newer version of Project Compass (schema v${v}). Please update the app.`);
  }
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration available from schema v${v}.`);
    data = step(data);
    v = data.schemaVersion as number;
  }
  return data;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const optStr = (x: unknown) => x === undefined || isStr(x);
const optDue = (x: unknown) => x === undefined || x === '' || isValidDue(x);

/** Returns a list of human-readable problems. Empty list = valid. */
export function validate(data: unknown): string[] {
  const errs: string[] = [];
  if (!isObj(data)) return ['File does not contain a JSON object.'];
  if (!Array.isArray(data.projects)) errs.push('Missing "projects" array.');
  if (!Array.isArray(data.activity)) errs.push('Missing "activity" array.');
  if (!isObj(data.weeks)) errs.push('Missing "weeks" object.');
  if (!isObj(data.settings)) errs.push('Missing "settings" object.');
  if (errs.length) return errs;

  const ids = new Set<string>();
  (data.projects as unknown[]).forEach((p, i) => {
    const at = `Project #${i + 1}`;
    if (!isObj(p)) return errs.push(`${at} is not an object.`);
    const name = isStr(p.name) ? `"${p.name}"` : at;
    if (!isStr(p.id) || !p.id) errs.push(`${at} has no id.`);
    else if (ids.has(p.id)) errs.push(`${name} has a duplicate id "${p.id}".`);
    else ids.add(p.id);
    if (!isStr(p.name)) errs.push(`${at} has no name.`);
    if (!STATUSES.includes(p.status as string)) errs.push(`${name} has an invalid status.`);
    if (!PRIORITIES.includes(p.priority as string)) errs.push(`${name} has an invalid priority.`);
    if (!CATEGORIES.includes(p.category as string)) errs.push(`${name} has an invalid category.`);
    if (!optDue(p.deadline) || !optDue(p.nextActionDue)) errs.push(`${name} has an invalid date.`);
    if (!Array.isArray(p.tasks)) errs.push(`${name} is missing tasks.`);
    else
      p.tasks.forEach((t) => {
        if (!isObj(t) || !isStr(t.id) || !isStr(t.title) || !TASK_STATUSES.includes(t.status as string) || !optDue(t.due))
          errs.push(`${name} has an invalid task.`);
      });
    if (!Array.isArray(p.milestones)) errs.push(`${name} is missing milestones.`);
    else
      p.milestones.forEach((m) => {
        if (!isObj(m) || !isStr(m.id) || !isStr(m.title) || typeof m.done !== 'boolean' || !optDue(m.targetDate))
          errs.push(`${name} has an invalid milestone.`);
      });
    for (const k of ['description', 'nextAction', 'notes', 'blockers', 'waitingOn', 'repoUrl', 'websiteUrl'])
      if (!optStr(p[k])) errs.push(`${name}: "${k}" must be text.`);
  });
  (data.activity as unknown[]).forEach((a, i) => {
    if (!isObj(a) || !isStr(a.id) || !isStr(a.at) || !isStr(a.text)) errs.push(`Activity entry #${i + 1} is invalid.`);
  });
  return errs;
}

/** Fill optional fields with safe defaults so the UI never sees undefined arrays/strings. */
export function normalize(data: Record<string, unknown>): AppData {
  const seed = createSeedData();
  const d = data as unknown as AppData;
  return {
    schemaVersion: SCHEMA_VERSION,
    seededAt: d.seededAt ?? seed.seededAt,
    settings: { ...seed.settings, ...(d.settings ?? {}) },
    allocations: Array.isArray(d.allocations) ? d.allocations : seed.allocations,
    weeks: d.weeks ?? {},
    activity: d.activity ?? [],
    projects: (d.projects ?? []).map(
      (p): Project => ({
        ...p,
        description: p.description ?? '',
        type: p.type ?? '',
        phase: p.phase ?? '',
        milestone: p.milestone ?? '',
        nextAction: p.nextAction ?? '',
        blockers: p.blockers ?? '',
        waitingOn: p.waitingOn ?? '',
        notes: p.notes ?? '',
        relatedIds: p.relatedIds ?? [],
        tasks: p.tasks ?? [],
        milestones: p.milestones ?? [],
        createdAt: p.createdAt ?? seed.seededAt,
        updatedAt: p.updatedAt ?? seed.seededAt,
        lastActivity: p.lastActivity ?? p.updatedAt ?? seed.seededAt,
      }),
    ),
  };
}

/** Parse + migrate + validate + normalize. Throws an Error with a readable message. */
export function parseAppData(json: string): AppData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (!isObj(raw)) throw new Error('The file does not contain Project Compass data.');
  const migrated = migrate(raw);
  const errs = validate(migrated);
  if (errs.length) throw new Error(`The file failed validation:\n• ${errs.slice(0, 8).join('\n• ')}${errs.length > 8 ? `\n…and ${errs.length - 8} more` : ''}`);
  return normalize(migrated);
}

export interface LoadResult {
  data: AppData;
  source: 'stored' | 'seed' | 'recovered';
  error?: string;
}

export function loadData(kv: KV): LoadResult {
  const raw = kv.getItem(STORAGE_KEY);
  if (!raw) return { data: createSeedData(), source: 'seed' };
  try {
    return { data: parseAppData(raw), source: 'stored' };
  } catch (e) {
    // Never silently discard unreadable data: stash it so it can be exported/recovered.
    kv.setItem(`${STORAGE_KEY}:corrupt:${Date.now()}`, raw);
    return { data: createSeedData(), source: 'recovered', error: (e as Error).message };
  }
}

export function saveData(kv: KV, data: AppData): void {
  kv.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function backupCurrent(kv: KV): void {
  const raw = kv.getItem(STORAGE_KEY);
  if (raw) kv.setItem(BACKUP_KEY, raw);
}

export function exportJSON(data: AppData): string {
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString(), app: 'project-compass' }, null, 2);
}

export function memoryStorage(initial: Record<string, string> = {}): KV & { dump(): Record<string, string> } {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}
