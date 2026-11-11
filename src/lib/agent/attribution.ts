// Attribution and idempotency for external (agent) changes. Uses the existing activity
// log — no parallel history. Every entry an operation adds is stamped with `source` and
// `opId`, which is also how repeated requests are detected.

import type { ActivityEntry, ActivitySource, AppData } from '../../data/types.ts';
import { stableStringify } from '../sync.ts';

export interface AgentContext {
  /** Current instant (injected for testability). */
  now: Date;
  /** User's IANA time zone, e.g. "America/Toronto". */
  timeZone: string;
  /** Integration display name, e.g. "ChatGPT". */
  agent: string;
  /** OAuth client id of the caller, when known. */
  clientId?: string;
  /** Stable operation id (see `deriveOpId`). */
  opId: string;
}

/** How long an identical request without a request_id counts as a repeat. */
export const DEDUPE_WINDOW_MS = 10 * 60_000;

/** Small, dependency-free 64-bit FNV-1a style hash (two 32-bit lanes). Not cryptographic. */
export function hash64(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000197) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * Operation id. With a client-supplied `request_id` it is fully stable (`r:`). Otherwise it
 * is the hash of tool + canonical arguments plus the time (`h:<hash>:<ms36>`); a repeat is
 * then recognised by the hash part within DEDUPE_WINDOW_MS.
 */
export function deriveOpId(tool: string, input: Record<string, unknown>, now: Date): string {
  const { request_id, ...args } = input as { request_id?: unknown };
  if (typeof request_id === 'string' && request_id.trim()) return `r:${hash64(`${tool}\u0000${request_id.trim()}`)}`;
  return `h:${hash64(`${tool}\u0000${stableStringify(args)}`)}:${now.getTime().toString(36)}`;
}

const hashPart = (opId: string) => (opId.startsWith('h:') ? opId.split(':')[1] : null);

/** Activity entries already written by this operation (or an identical recent one). */
export function findPriorOp(d: AppData, opId: string, now: Date): ActivityEntry[] {
  const h = hashPart(opId);
  const since = now.getTime() - DEDUPE_WINDOW_MS;
  return d.activity.filter((e) => {
    if (!e.opId) return false;
    if (e.opId === opId) return true;
    return h !== null && hashPart(e.opId) === h && new Date(e.at).getTime() >= since;
  });
}

export function sourceOf(ctx: AgentContext): ActivitySource {
  return { type: 'agent', agent: ctx.agent, ...(ctx.clientId ? { clientId: ctx.clientId } : {}) };
}

/** Stamp every activity entry present in `after` but not in `before` with source/opId (and taskId if given). */
export function attributeNewEntries(before: AppData, after: AppData, ctx: AgentContext, taskId?: string): AppData {
  const old = new Set(before.activity.map((e) => e.id));
  const source = sourceOf(ctx);
  let changed = false;
  const activity = after.activity.map((e) => {
    if (old.has(e.id)) return e;
    changed = true;
    return { ...e, source, opId: ctx.opId, ...(taskId && !e.taskId ? { taskId } : {}) };
  });
  return changed ? { ...after, activity } : after;
}
