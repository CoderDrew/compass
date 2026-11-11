// Browser-side rules for AI assistant access (pure; unit-tested).

import type { KV } from './storage';

export interface AiSettings {
  ai_access_enabled: boolean;
  allowed_client_ids: string[];
  /** Display names of approved clients, keyed by client id. */
  client_names: Record<string, string>;
}

export const EMPTY_AI_SETTINGS: AiSettings = { ai_access_enabled: false, allowed_client_ids: [], client_names: {} };

/** Settings after approving `clientId` on the consent page. */
export function approveClient(s: AiSettings, clientId: string, name: string, enableAccess: boolean): AiSettings {
  return {
    ai_access_enabled: s.ai_access_enabled || enableAccess,
    allowed_client_ids: s.allowed_client_ids.includes(clientId) ? s.allowed_client_ids : [...s.allowed_client_ids, clientId],
    client_names: { ...s.client_names, [clientId]: (name.trim() || 'AI assistant').slice(0, 60) },
  };
}

/** Settings after disconnecting `clientId`. */
export function removeClient(s: AiSettings, clientId: string): AiSettings {
  const { [clientId]: _removed, ...names } = s.client_names;
  return { ...s, allowed_client_ids: s.allowed_client_ids.filter((id) => id !== clientId), client_names: names };
}

/** Return addresses of assistants we expect; anything else gets an extra warning. */
const KNOWN_REDIRECT_HOSTS = ['claude.ai', 'claude.com', 'chatgpt.com'];

export type RedirectCheck = { ok: true; host: string; known: boolean } | { ok: false; reason: string };

export function checkRedirect(uri: string): RedirectCheck {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return { ok: false, reason: 'The app gave an invalid return address.' };
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { ok: false, reason: 'The app’s return address is not secure (https).' };
  const known = KNOWN_REDIRECT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  return { ok: true, host: u.hostname, known };
}

// ── Pending authorization (survives the sign-in email opening a new tab) ──────

export const PENDING_KEY = 'project-compass:pending-authorization';
const PENDING_TTL_MS = 15 * 60_000;

const ID = /^[A-Za-z0-9._~-]{8,200}$/;

export function savePending(kv: KV, authorizationId: string, now = Date.now()): boolean {
  if (!ID.test(authorizationId)) return false;
  kv.setItem(PENDING_KEY, JSON.stringify({ id: authorizationId, at: now }));
  return true;
}

export function readPending(kv: KV, now = Date.now()): string | null {
  try {
    const v = JSON.parse(kv.getItem(PENDING_KEY) ?? 'null') as { id?: unknown; at?: unknown } | null;
    if (!v || typeof v.id !== 'string' || typeof v.at !== 'number' || !ID.test(v.id)) return null;
    if (now - v.at > PENDING_TTL_MS) {
      kv.removeItem(PENDING_KEY);
      return null;
    }
    return v.id;
  } catch {
    return null;
  }
}

export const clearPending = (kv: KV) => kv.removeItem(PENDING_KEY);
