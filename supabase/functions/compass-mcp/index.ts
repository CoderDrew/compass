// Supabase Edge Function entry (Deno). Deploy with:
//   npm run build:shared && npx supabase functions deploy compass-mcp --no-verify-jwt
// (verify_jwt is also disabled in supabase/config.toml: discovery requests carry no token,
// and handler.ts verifies every other request itself.)

import { createClient } from '@supabase/supabase-js';
import { createRemoteJWKSet } from 'jose';
import { createCompassHandler } from './handler.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL').replace(/\/+$/, '');
// Service-role key: provided to Edge Functions automatically. Never sent to clients.
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY') || env('COMPASS_SERVICE_KEY');
const ISSUER = env('MCP_AUTH_ISSUER') || `${SUPABASE_URL}/auth/v1`;
const RESOURCE_URL = env('MCP_RESOURCE_URL') || `${SUPABASE_URL}/functions/v1/compass-mcp`;

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('compass-mcp: SUPABASE_URL and a service-role key are required');

const rpc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(
  createCompassHandler({
    issuer: ISSUER,
    resourceUrl: RESOURCE_URL,
    jwks: createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`)),
    rpc,
    log: (e) => console.log(JSON.stringify({ fn: 'compass-mcp', ...e })),
  }),
);
