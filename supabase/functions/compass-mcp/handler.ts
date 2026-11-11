// HTTP entry for the Compass MCP server (runtime-neutral: used by index.ts under Deno and
// by the Node tests). Responsibilities:
//   • OAuth Protected Resource Metadata (RFC 9728) for discovery
//   • 401 + WWW-Authenticate challenge pointing at that metadata (MCP authorization spec)
//   • access-token verification against the Supabase project's JWKS
//   • only tokens issued to an OAuth client (client_id claim) are accepted
//   • hands the request to a per-request MCP server bound to the verified caller

import { createMcpHandler } from '@modelcontextprotocol/server';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { RpcClient } from '../_shared/compass-agent.js';
import { createCompassServer } from './server.ts';

export interface CompassHandlerConfig {
  /** Supabase Auth issuer, e.g. https://<ref>.supabase.co/auth/v1 */
  issuer: string;
  /** Public URL of this function, e.g. https://<ref>.supabase.co/functions/v1/compass-mcp */
  resourceUrl: string;
  /** Key set used to verify access tokens (remote JWKS in production). */
  jwks: JWTVerifyGetKey;
  /** Service-role RPC client. */
  rpc: RpcClient;
  now?: () => Date;
  /** Operational log hook (never receives tokens). */
  log?: (event: Record<string, unknown>) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'www-authenticate, mcp-session-id',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...headers } });
}

export function createCompassHandler(cfg: CompassHandlerConfig): (req: Request) => Promise<Response> {
  const resource = cfg.resourceUrl.replace(/\/+$/, '');
  const metadataUrl = `${resource}/.well-known/oauth-protected-resource`;
  const metadata = {
    resource,
    authorization_servers: [cfg.issuer],
    bearer_methods_supported: ['header'],
    resource_name: 'Project Compass',
    resource_documentation: 'https://github.com/CoderDrew/compass/blob/main/docs/integrations/mcp-tools.md',
  };
  const challenge = (error?: string, description?: string) =>
    json(
      401,
      { error: error ?? 'unauthorized', error_description: description ?? 'Sign in to Compass to use this server.' },
      { 'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}"${error ? `, error="${error}", error_description="${description}"` : ''}` },
    );
  const log = (e: Record<string, unknown>) => {
    try {
      cfg.log?.(e);
    } catch {
      /* ignore */
    }
  };

  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method === 'GET' && (path.endsWith('/.well-known/oauth-protected-resource') || path.endsWith('/oauth-protected-resource'))) return json(200, metadata);

    const auth = req.headers.get('authorization') ?? '';
    const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
    if (!token) return challenge();

    let claims: Record<string, unknown>;
    try {
      ({ payload: claims } = await jwtVerify(token, cfg.jwks, {
        issuer: cfg.issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256', 'EdDSA'],
        currentDate: cfg.now?.(),
      }));
    } catch (e) {
      log({ event: 'auth_rejected', reason: (e as { code?: string }).code ?? 'invalid' });
      return challenge('invalid_token', 'The access token is invalid or expired.');
    }

    const userId = typeof claims.sub === 'string' && UUID.test(claims.sub) ? claims.sub : null;
    const clientId = typeof claims.client_id === 'string' && claims.client_id ? claims.client_id : null;
    if (!userId) return challenge('invalid_token', 'The access token has no user.');
    if (!clientId) {
      // A normal Compass browser session token: not accepted here (least privilege).
      log({ event: 'auth_rejected', reason: 'no_client_id' });
      return json(403, { error: 'insufficient_scope', error_description: 'Connect through your AI assistant; app session tokens are not accepted.' });
    }

    const caller = { userId, clientId };
    const handler = createMcpHandler(() => createCompassServer({ rpc: cfg.rpc, caller, now: cfg.now }), { legacy: 'stateless' });
    try {
      const res = await handler.fetch(req, {
        authInfo: { token, clientId, scopes: typeof claims.scope === 'string' ? claims.scope.split(' ') : [], expiresAt: typeof claims.exp === 'number' ? claims.exp : undefined },
      });
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    } catch (e) {
      log({ event: 'mcp_error', message: (e as Error).message });
      return json(500, { error: 'server_error' });
    } finally {
      void handler.close();
    }
  };
}
