// The one procedure every agent request goes through. Storage is injected, so the same
// code runs against an in-memory store in tests and the Supabase data service later.
//
//   load → parse/validate → (dedupe) → apply tool via ops.ts → attribute → check invariants
//   → commit with expected revision → on conflict: reload and re-apply (bounded)
//
// Re-applying the *command* to fresh data (instead of re-sending the old document) is what
// keeps concurrent browser edits: the agent's change is rebased on top of them.

import type { AppData } from '../../data/types.ts';
import { parseAppData } from '../storage.ts';
import { attributeNewEntries, deriveOpId, findPriorOp, type AgentContext } from './attribution.ts';
import { fail, toAgentError, type AgentError } from './errors.ts';
import { checkInvariants } from './invariants.ts';
import { isToolName, parseToolInput, TOOLS } from './tools.ts';

export interface StoredPortfolio {
  data: unknown;
  revision: number;
}

export interface CommitMeta {
  opId: string;
  tool: string;
}

export type CommitResult = { ok: true; revision: number } | { ok: false; reason: 'conflict' };

/** Storage port. `commit` MUST be an atomic compare-and-set on `expectedRevision`. */
export interface PortfolioStore {
  load(): Promise<StoredPortfolio | null>;
  commit(expectedRevision: number, data: AppData, meta: CommitMeta): Promise<CommitResult>;
}

export type RunResult =
  | { ok: true; opId?: string; result: unknown; revision: number; duplicate?: boolean; attempts?: number }
  | { ok: false; error: AgentError };

export interface RunOptions {
  /** Total load→apply→commit attempts before giving up (default 3). */
  maxAttempts?: number;
}

export async function runTool(
  store: PortfolioStore,
  name: string,
  rawInput: unknown,
  base: Omit<AgentContext, 'opId'>,
  opts: RunOptions = {},
): Promise<RunResult> {
  let opId: string | undefined;
  try {
    if (!isToolName(name)) fail('INVALID_INPUT', `Unknown tool "${name}".`);
    const tool = TOOLS[name];
    const input = parseToolInput(name, rawInput);
    opId = tool.kind === 'write' ? deriveOpId(name, input, base.now) : undefined;
    const ctx: AgentContext = { ...base, opId: opId ?? '' };
    const max = Math.max(1, opts.maxAttempts ?? 3);

    for (let attempt = 1; attempt <= max; attempt++) {
      const row = await store.load();
      if (!row) fail('NOT_FOUND', 'No Compass data in the cloud yet. Open Compass, sign in to cloud sync, and try again.');
      let data: AppData;
      try {
        data = parseAppData(JSON.stringify(row.data));
      } catch (e) {
        return fail('DATA_INVALID', 'Your stored Compass data did not pass validation, so nothing was changed. Open Compass to check it.', {
          details: [(e as Error).message],
        });
      }

      if (tool.kind === 'read') return { ok: true, result: tool.run(data, input as never, ctx), revision: row.revision };

      const prior = findPriorOp(data, ctx.opId, base.now);
      if (prior.length)
        return {
          ok: true,
          duplicate: true,
          opId: prior[0].opId,
          revision: row.revision,
          result: { message: 'This request was already applied; nothing changed.', entries: prior.map((e) => ({ id: e.id, at: e.at, kind: e.kind, text: e.text })) },
        };

      const out = tool.run(data, input as never, ctx);
      const next = attributeNewEntries(data, out.data, ctx, out.taskId);
      checkInvariants(data, next, out.scope);

      const res = await store.commit(row.revision, next, { opId: ctx.opId, tool: name });
      if (res.ok) return { ok: true, opId: ctx.opId, result: out.result, revision: res.revision, attempts: attempt };
    }
    return fail('CONFLICT_RETRY_EXHAUSTED', 'Compass data kept changing while saving. Nothing was changed; try again in a moment.');
  } catch (e) {
    return { ok: false, error: toAgentError(e, opId) };
  }
}

/** In-memory store with an atomic CAS — for tests and local experiments. */
export function memoryPortfolioStore(initial: AppData | null, revision = 1) {
  let row: StoredPortfolio | null = initial ? { data: JSON.parse(JSON.stringify(initial)), revision } : null;
  const commits: CommitMeta[] = [];
  return {
    commits,
    get row() {
      return row;
    },
    /** Simulate another device writing (bumps the revision). */
    externalWrite(fn: (d: AppData) => AppData) {
      if (!row) throw new Error('empty store');
      row = { data: JSON.parse(JSON.stringify(fn(parseAppData(JSON.stringify(row.data))))), revision: row.revision + 1 };
    },
    async load() {
      return row ? { data: JSON.parse(JSON.stringify(row.data)), revision: row.revision } : null;
    },
    async commit(expected: number, data: AppData, meta: CommitMeta): Promise<CommitResult> {
      if (!row || row.revision !== expected) return { ok: false, reason: 'conflict' };
      row = { data: JSON.parse(JSON.stringify(data)), revision: expected + 1 };
      commits.push(meta);
      return { ok: true, revision: row.revision };
    },
  } satisfies PortfolioStore & Record<string, unknown>;
}
