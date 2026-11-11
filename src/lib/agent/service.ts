// Supabase data service for agent requests (Phase 2).
//
// Talks only to the server-only SQL functions from supabase/migrations/*_ai_access.sql
// (compass_mcp_authorize / _read / _commit / _log) through a minimal RPC interface, so
// this file has no dependency on supabase-js and runs unchanged in Deno. The caller (the
// MCP Edge Function, Phase 3) must pass a client authenticated with the service role and a
// `userId` taken ONLY from a verified access token.

import type { AppData } from '../../data/types.ts';
import { fail, type AgentError } from './errors.ts';
import { runTool, type CommitResult, type PortfolioStore, type RunResult, type StoredPortfolio } from './run.ts';
import { isToolName, TOOLS } from './tools.ts';

export interface RpcError {
  message: string;
  code?: string;
}

/** The subset of supabase-js used here: `client.rpc(fn, args)`. */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

/** Identity of the caller, from a verified OAuth access token. */
export interface Caller {
  userId: string;
  clientId: string;
  /** Display name for attribution, e.g. "ChatGPT". */
  agent: string;
}

async function call<T>(rpc: RpcClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** PortfolioStore backed by compass_mcp_read / compass_mcp_commit (atomic CAS + backup). */
export function supabasePortfolioStore(rpc: RpcClient, caller: Caller): PortfolioStore {
  return {
    async load(): Promise<StoredPortfolio | null> {
      const rows = await call<{ data: unknown; revision: number | string }[] | null>(rpc, 'compass_mcp_read', { p_user: caller.userId });
      const row = Array.isArray(rows) ? rows[0] : null;
      return row ? { data: row.data, revision: Number(row.revision) } : null;
    },
    async commit(expectedRevision: number, data: AppData, meta): Promise<CommitResult> {
      const res = await call<{ ok: boolean; revision?: number | string; reason?: string }>(rpc, 'compass_mcp_commit', {
        p_user: caller.userId,
        p_expected: expectedRevision,
        p_data: data,
        p_op_id: meta.opId,
        p_device: caller.agent,
      });
      return res?.ok ? { ok: true, revision: Number(res.revision) } : { ok: false, reason: 'conflict' };
    },
  };
}

type Outcome = 'ok' | 'duplicate' | 'error' | 'rate_limited' | 'forbidden';

/**
 * Full server-side handling of one tool call: access check (kill switch, approved client,
 * rate limit) → runTool against the Supabase store → operational log. Never throws.
 */
export async function handleToolCall(
  rpc: RpcClient,
  caller: Caller,
  name: string,
  input: unknown,
  opts: { now?: Date; maxAttempts?: number } = {},
): Promise<RunResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const kind = isToolName(name) ? TOOLS[name].kind : 'read';
  let result: RunResult;
  let outcome: Outcome;

  try {
    const auth = await call<{ ok: boolean; code?: string; message?: string; retry_after?: number }>(rpc, 'compass_mcp_authorize', {
      p_user: caller.userId,
      p_client: caller.clientId,
      p_kind: kind,
    });
    if (!auth?.ok) {
      const code = auth?.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'FORBIDDEN';
      const error: AgentError =
        code === 'RATE_LIMITED'
          ? { code, message: `Too many requests. Try again in ${auth?.retry_after ?? 60} seconds.` }
          : { code, message: auth?.message ?? 'AI access is not allowed.' };
      result = { ok: false, error };
      outcome = code === 'RATE_LIMITED' ? 'rate_limited' : 'forbidden';
    } else {
      result = await runTool(supabasePortfolioStore(rpc, caller), name, input, { now, agent: caller.agent, clientId: caller.clientId }, { maxAttempts: opts.maxAttempts });
      outcome = !result.ok ? 'error' : result.duplicate ? 'duplicate' : 'ok';
    }
  } catch {
    result = { ok: false, error: { code: 'INTERNAL', message: 'Unexpected error.' } };
    outcome = 'error';
  }

  // Logging must never change the answer.
  try {
    await call(rpc, 'compass_mcp_log', {
      p_user: caller.userId,
      p_op_id: (result.ok ? result.opId : result.error.opId) ?? `read:${now.getTime().toString(36)}`,
      p_client: caller.clientId,
      p_tool: isToolName(name) ? name : 'unknown',
      p_kind: kind,
      p_outcome: outcome,
      p_error_code: result.ok ? null : result.error.code,
      p_revision_after: result.ok ? result.revision : null,
      p_duration_ms: Date.now() - started,
    });
  } catch {
    /* ignore */
  }
  return result;
}

/** Throws if an id isn't a UUID (defence in depth for values that reach SQL). */
export function assertUuid(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fail('UNAUTHORIZED', 'Invalid user.');
  return id;
}
