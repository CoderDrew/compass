import { Bot, Globe, Unplug } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { formatTimestamp } from '../lib/dates';
import { fetchAiSettings, getClient, listConnectedApps, revokeConnectedApp, saveAiSettings, type AiSettings, type ConnectedApp } from '../lib/cloud';
import { updateSettings } from '../lib/ops';
import { useStore } from '../state/store';
import { useSync } from '../state/sync';
import { Button, Card, CardHeader, cx } from './ui';

/**
 * "AI assistants" card on Data & settings: the kill switch for MCP access, the list of
 * approved/connected assistants with Disconnect, and the time zone assistants use.
 * Shown only when signed in to cloud sync.
 */
export function AiAccessCard() {
  const sync = useSync();
  const { data, apply, confirm, showToast } = useStore();
  const [settings, setSettings] = useState<AiSettings | null | undefined>(undefined); // undefined = loading, null = not installed
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = sync.userId;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const c = await getClient();
      const [s, a] = await Promise.all([fetchAiSettings(c, userId), listConnectedApps(c)]);
      setSettings(s);
      setApps(a);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setSettings(null);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!sync.configured || !userId) return null;

  const save = async (next: AiSettings, msg: string) => {
    setBusy(true);
    try {
      await saveAiSettings(await getClient(), userId, next);
      setSettings(next);
      showToast(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!settings) return;
    const on = !settings.ai_access_enabled;
    if (on) {
      const ok = await confirm({
        title: 'Allow AI assistants?',
        body: (
          <>
            <p>Assistants you approve will be able to read your portfolio and make limited changes: log notes, add and update tasks and milestones, update next actions, and plan your week.</p>
            <p className="mt-2">They can't delete anything or change statuses, priorities or deadlines. Every change shows in Activity, and you can turn this off at any time.</p>
          </>
        ),
        confirmLabel: 'Allow',
      });
      if (!ok) return;
    }
    await save({ ...settings, ai_access_enabled: on }, on ? 'AI access on' : 'AI access off — assistants are refused immediately');
  };

  const disconnect = async (app: ConnectedApp) => {
    if (!settings) return;
    const ok = await confirm({
      title: `Disconnect ${app.name}?`,
      body: 'It will lose access right away and would need your approval again to reconnect. Changes it already made stay in Compass.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const c = await getClient();
      await saveAiSettings(c, userId, { ...settings, allowed_client_ids: settings.allowed_client_ids.filter((id) => id !== app.clientId) });
      await revokeConnectedApp(c, app.clientId);
      showToast(`${app.name} disconnected`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Approved clients, named from OAuth grants when available.
  const approved: ConnectedApp[] = (settings?.allowed_client_ids ?? []).map((id) => apps.find((a) => a.clientId === id) ?? { clientId: id, name: 'Approved app' });
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tz = data.settings.timeZone;

  return (
    <Card className="mb-5">
      <CardHeader icon={<Bot size={15} />} title="AI assistants" />
      <div className="space-y-4 px-5 pb-5 text-sm">
        {settings === undefined ? (
          <p className="text-xs text-faint">Loading…</p>
        ) : settings === null ? (
          <p className="text-muted">AI access isn't set up on this Supabase project yet, so no assistant can reach your data.</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">Allow AI assistants to access Compass</p>
                <p className="mt-0.5 text-xs text-muted">Off by default. Turning it off refuses every assistant immediately.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.ai_access_enabled}
                aria-label="Allow AI assistants"
                disabled={busy}
                onClick={toggle}
                className={cx('relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50', settings.ai_access_enabled ? 'bg-accent' : 'bg-line')}
              >
                <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', settings.ai_access_enabled ? 'left-[18px]' : 'left-0.5')} />
              </button>
            </div>

            <div>
              <span className="label">Connected assistants</span>
              {approved.length ? (
                <ul className="divide-y divide-line/60 rounded-xl ring-1 ring-line/60">
                  {approved.map((a) => (
                    <li key={a.clientId} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{a.name}</p>
                        <p className="truncate text-xs text-faint">{a.grantedAt ? `Approved ${formatTimestamp(a.grantedAt)}` : a.clientId}</p>
                      </div>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => disconnect(a)}>
                        <Unplug size={13} /> Disconnect
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-faint">None yet. You connect an assistant from the assistant itself; it sends you to a Compass approval page.</p>
              )}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <Globe size={13} className="text-faint" />
          <span>
            Time zone for “today” and “this week”: <b className="font-medium text-ink">{tz ?? 'not set'}</b>
          </span>
          {deviceTz && deviceTz !== tz && (
            <Button size="sm" variant="ghost" onClick={() => apply((d) => updateSettings(d, { timeZone: deviceTz }), { toast: `Time zone set to ${deviceTz}` })}>
              Use {deviceTz}
            </Button>
          )}
        </div>
        {error && <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{error}</p>}
      </div>
    </Card>
  );
}
