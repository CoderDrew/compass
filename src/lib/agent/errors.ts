// Stable error model shared by the command layer and (later) the MCP adapter.

export type AgentErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'AMBIGUOUS_REFERENCE'
  | 'NOT_ALLOWED'
  | 'CONFLICT_RETRY_EXHAUSTED'
  | 'DATA_INVALID'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INTERNAL';

export interface RefSummary {
  id: string;
  name: string;
}

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  /** For AMBIGUOUS_REFERENCE: the matches to choose from. */
  candidates?: RefSummary[];
  /** For NOT_FOUND: closest names. */
  suggestions?: RefSummary[];
  /** For INVALID_INPUT / DATA_INVALID / NOT_ALLOWED: individual problems. */
  details?: string[];
  opId?: string;
}

/** Thrown inside commands; converted to `{ ok: false, error }` at the boundary. */
export class AgentFailure extends Error {
  readonly error: AgentError;
  constructor(error: AgentError) {
    super(error.message);
    this.error = error;
  }
}

export function fail(code: AgentErrorCode, message: string, extra: Omit<AgentError, 'code' | 'message'> = {}): never {
  throw new AgentFailure({ code, message, ...extra });
}

export function toAgentError(e: unknown, opId?: string): AgentError {
  if (e instanceof AgentFailure) return opId ? { ...e.error, opId } : e.error;
  return { code: 'INTERNAL', message: 'Unexpected error.', ...(opId ? { opId } : {}) };
}
