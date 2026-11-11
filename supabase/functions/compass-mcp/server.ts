// Builds the Compass MCP server for one authenticated request. All behaviour lives in the
// shared command layer (../_shared/compass-agent.js); this file only registers the tools.
// Bare specifiers resolve from node_modules in tests and via deno.json in the Edge Function.

import { McpServer, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { handleToolCall, SERVER_INFO, SERVER_INSTRUCTIONS, TOOL_SPECS, toCallToolResult, type Caller, type RpcClient } from '../_shared/compass-agent.js';

/**
 * Advertises our JSON Schema but lets every argument through: validation happens once, in
 * the command layer, so invalid input comes back as a structured INVALID_INPUT tool result
 * the assistant can act on (instead of a generic protocol error).
 */
function publishedSchema(json: Record<string, unknown>): StandardSchemaWithJSON<Record<string, unknown>> {
  return {
    '~standard': {
      version: 1,
      vendor: 'compass',
      validate: (value: unknown) => ({ value: (value ?? {}) as Record<string, unknown> }),
      jsonSchema: { input: () => json, output: () => json },
    },
  };
}

export interface CompassServerDeps {
  /** Service-role RPC client (server-side only). */
  rpc: RpcClient;
  /** Identity from the verified access token. */
  caller: Caller;
  now?: () => Date;
}

export function createCompassServer(deps: CompassServerDeps): McpServer {
  const server = new McpServer({ ...SERVER_INFO }, { instructions: SERVER_INSTRUCTIONS });
  for (const spec of TOOL_SPECS) {
    server.registerTool(
      spec.name,
      { title: spec.title, description: spec.description, inputSchema: publishedSchema(spec.inputSchema), annotations: spec.annotations },
      async (args) => toCallToolResult(await handleToolCall(deps.rpc, deps.caller, spec.name, args, { now: deps.now?.() })),
    );
  }
  return server;
}
