import { describe, expect, it } from 'vitest';
import { approveClient, checkRedirect, EMPTY_AI_SETTINGS, PENDING_KEY, readPending, removeClient, savePending } from './aiAccess';
import { memoryStorage } from './storage';

describe('AI access settings', () => {
  it('approving adds the client once, names it, and can turn access on', () => {
    const a = approveClient(EMPTY_AI_SETTINGS, 'c1', 'Claude', true);
    expect(a).toEqual({ ai_access_enabled: true, allowed_client_ids: ['c1'], client_names: { c1: 'Claude' } });
    const b = approveClient(a, 'c1', 'Claude (renamed)', false);
    expect(b.allowed_client_ids).toEqual(['c1']);
    expect(b.client_names.c1).toBe('Claude (renamed)');
    expect(b.ai_access_enabled).toBe(true); // approving never turns access off
    expect(approveClient(EMPTY_AI_SETTINGS, 'c2', '  ', false)).toMatchObject({ ai_access_enabled: false, client_names: { c2: 'AI assistant' } });
  });

  it('disconnecting removes the client and its name only', () => {
    const s = approveClient(approveClient(EMPTY_AI_SETTINGS, 'c1', 'Claude', true), 'c2', 'Muse', false);
    expect(removeClient(s, 'c1')).toEqual({ ai_access_enabled: true, allowed_client_ids: ['c2'], client_names: { c2: 'Muse' } });
  });
});

describe('redirect checks', () => {
  it('recognises assistant callbacks and rejects insecure ones', () => {
    expect(checkRedirect('https://claude.ai/api/mcp/auth_callback')).toEqual({ ok: true, host: 'claude.ai', known: true });
    expect(checkRedirect('https://chatgpt.com/connector_platform_oauth_redirect')).toMatchObject({ known: true });
    expect(checkRedirect('https://evil-claude.ai.example.com/cb')).toMatchObject({ ok: true, known: false });
    expect(checkRedirect('http://localhost:6274/oauth/callback')).toMatchObject({ ok: true, known: false });
    expect(checkRedirect('http://example.com/cb')).toMatchObject({ ok: false });
    expect(checkRedirect('not a url')).toMatchObject({ ok: false });
  });
});

describe('pending authorization', () => {
  it('survives a reload within 15 minutes and rejects junk', () => {
    const kv = memoryStorage();
    expect(savePending(kv, 'auth_0123456789abcdef', 1_000)).toBe(true);
    expect(readPending(kv, 1_000 + 14 * 60_000)).toBe('auth_0123456789abcdef');
    expect(readPending(kv, 1_000 + 16 * 60_000)).toBeNull();
    expect(kv.getItem(PENDING_KEY)).toBeNull();
    expect(savePending(kv, '<script>')).toBe(false);
    expect(readPending(memoryStorage({ [PENDING_KEY]: '{"id":"a b","at":1}' }), 2)).toBeNull();
  });
});
