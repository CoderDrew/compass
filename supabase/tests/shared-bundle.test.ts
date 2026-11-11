import { describe, expect, it } from 'vitest';
import { buildSharedBundle } from '../../scripts/build-shared.mjs';
import { createSeedData } from '../../src/data/seed';

const committed = (import.meta.glob('../functions/_shared/compass-agent.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[
  '../functions/_shared/compass-agent.js'
];

describe('shared bundle for the Edge Function (D5)', () => {
  it('is up to date with src/lib/agent (run `npm run build:shared` if this fails)', async () => {
    expect(committed.replace(/\r\n/g, '\n')).toBe(await buildSharedBundle());
  });

  it('is self-contained: no imports, no Node/browser globals', () => {
    expect(committed).not.toMatch(/^\s*import\s|require\(|from\s+['"]node:/m);
    expect(committed).not.toMatch(/\bwindow\.|\blocalStorage\b|\bdocument\.|process\.env/);
  });

  it('works when loaded as a module', async () => {
    const mod = await import('../functions/_shared/compass-agent.js');
    const store = mod.memoryPortfolioStore(createSeedData(new Date('2026-11-01T12:00:00Z')));
    const r = await mod.runTool(store, 'complete_milestone', { project: 'voidraider', milestone: 'playtesting' }, { now: new Date('2026-11-11T15:00:00Z'), agent: 'Test' });
    expect(r).toMatchObject({ ok: true, revision: 2 });
    expect(Object.keys(mod.TOOLS)).toHaveLength(11);
  });
});
