// MCP-facing definitions for the Compass tools, kept free of any SDK import so they are
// unit-tested here and bundled into the Edge Function unchanged.

import type { RunResult } from './run.ts';
import { toJsonSchema } from './schema.ts';
import { TOOLS, type ToolName } from './tools.ts';

export const SERVER_INFO = { name: 'compass', title: 'Project Compass', version: '1.0.0' } as const;

/** Guidance sent to the assistant at connection time. */
export const SERVER_INSTRUCTIONS = [
  "Compass is the user's personal project portfolio. It is the source of truth; change it only through these tools.",
  'Refer to projects, tasks and milestones by id when you have one. Names work too; if a tool reports AMBIGUOUS_REFERENCE, ask the user which candidate they mean instead of guessing.',
  'Never invent dates. Only pass due/target dates the user stated; a month alone (YYYY-MM) is fine.',
  'Status, priority and deadlines cannot be changed through this integration. Nothing can be deleted.',
  'Some things users call "tasks" are milestones (e.g. a playtesting round). If update_task says a milestone matches, use complete_milestone.',
  'Hobby projects marked lowPressure are never overdue; do not nag about them.',
  'For write tools, pass a short unique request_id so retries are never applied twice.',
].join('\n');

const TITLES: Record<ToolName, string> = {
  list_projects: 'List projects',
  get_project: 'Get project',
  get_activity: 'Get activity history',
  get_week_plan: 'Get week plan',
  add_activity: 'Log note or decision',
  create_task: 'Create task',
  update_task: 'Update task',
  update_project: 'Update project',
  update_week_plan: 'Update week plan',
  create_milestone: 'Create milestone',
  complete_milestone: 'Complete milestone',
};

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface McpToolSpec {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
}

export const TOOL_SPECS: McpToolSpec[] = (Object.keys(TOOLS) as ToolName[]).map((name) => {
  const t = TOOLS[name];
  const read = t.kind === 'read';
  return {
    name,
    title: TITLES[name],
    description: t.description,
    inputSchema: toJsonSchema(t.input),
    annotations: {
      title: TITLES[name],
      readOnlyHint: read,
      // No tool deletes or overwrites user data; every write is additive or a scoped update.
      destructiveHint: false,
      // Reads are naturally idempotent; writes are via request_id / repeat detection.
      idempotentHint: true,
      // A private, bounded workspace — not the open web.
      openWorldHint: false,
    },
  };
});

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

/** Map a command-layer result to an MCP CallToolResult (errors are tool results, not protocol errors). */
export function toCallToolResult(r: RunResult): McpToolResult {
  if (!r.ok) {
    const body = { ok: false, error: r.error };
    return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body, isError: true };
  }
  const result = (r.result && typeof r.result === 'object' ? r.result : { value: r.result }) as Record<string, unknown>;
  const body = { ok: true, ...(r.duplicate ? { duplicate: true } : {}), ...result };
  return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
}
