import { AlertTriangle, Cloud, Download, HardDrive, RotateCcw, Upload } from 'lucide-react';
import { useRef } from 'react';
import { AiAccessCard } from '../components/AiAccessCard';
import { SyncCard } from '../components/SyncPanel';
import { Button, Card, CardHeader, PageHeader, cx } from '../components/ui';
import { createSeedData } from '../data/seed';
import { SCHEMA_VERSION } from '../data/types';
import { formatTimestamp, toISODate } from '../lib/dates';
import { updateSettings } from '../lib/ops';
import { BACKUP_KEY, backupCurrent, exportJSON, parseAppData } from '../lib/storage';
import { useStore } from '../state/store';
import { useSync } from '../state/sync';

export function DataSettings() {
  const { data, apply, replaceData, confirm, showToast } = useStore();
  const sync = useSync();
  const synced = !!sync.email;
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRaw = localStorage.getItem(BACKUP_KEY);
  const sizeKb = Math.round(new Blob([JSON.stringify(data)]).size / 1024);
  const tasks = data.projects.reduce((s, p) => s + p.tasks.length, 0);
  const milestones = data.projects.reduce((s, p) => s + p.milestones.length, 0);

  const doExport = () => {
    const blob = new Blob([exportJSON(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-compass-backup-${toISODate(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Backup downloaded');
  };

  const doImport = async (file: File) => {
    let incoming;
    try {
      incoming = parseAppData(await file.text());
    } catch (e) {
      await confirm({ title: 'Import failed', body: <pre className="whitespace-pre-wrap font-sans">{(e as Error).message}</pre>, confirmLabel: 'OK', info: true });
      return;
    }
    const ok = await confirm({
      title: 'Replace current data?',
      body: (
        <>
          <p>
            <b>{file.name}</b> contains {incoming.projects.length} projects, {incoming.activity.length} activity entries and {Object.keys(incoming.weeks).length} weekly plans.
          </p>
          <p className="mt-2">
            This <b>replaces</b> everything currently in this browser ({data.projects.length} projects). Your current data is saved as a one-step backup you can restore below.
          </p>
          {synced && <p className="mt-2">Because cloud sync is on, your other devices will get the imported data too.</p>}
        </>
      ),
      confirmLabel: 'Import and replace',
      danger: true,
    });
    if (!ok) return;
    backupCurrent(localStorage);
    replaceData(incoming, 'Data imported');
  };

  const restoreBackup = async () => {
    if (!backupRaw) return;
    let backup;
    try {
      backup = parseAppData(backupRaw);
    } catch (e) {
      showToast(`Backup unreadable: ${(e as Error).message}`);
      return;
    }
    const ok = await confirm({
      title: 'Restore previous backup?',
      body: `Swaps current data (${data.projects.length} projects) with the automatic backup (${backup.projects.length} projects). The current data becomes the new backup.${synced ? ' Your other devices will get the restored data too.' : ''}`,
      confirmLabel: 'Restore backup',
      danger: true,
    });
    if (!ok) return;
    backupCurrent(localStorage);
    replaceData(backup, 'Backup restored');
  };

  const resetSeed = async () => {
    const ok = await confirm({
      title: 'Restore the original seed dataset?',
      body: (
        <>
          All current projects, tasks, milestones, activity and weekly plans will be replaced with the initial snapshot. <b>Export a backup first</b> if you might need
          anything. An automatic one-step backup is also kept.{synced && ' Because cloud sync is on, this also resets your other devices.'}
        </>
      ),
      confirmLabel: 'Restore seed data',
      danger: true,
    });
    if (!ok) return;
    backupCurrent(localStorage);
    replaceData({ ...createSeedData(), settings: data.settings }, 'Seed data restored');
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Data & settings" subtitle="Backups, moving between devices, and preferences." />

      {synced ? (
        <div className="mb-5 flex gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.07] p-4 text-sm">
          <Cloud size={18} className="mt-0.5 shrink-0 text-emerald-500" />
          <div>
            <p className="font-medium">Synced with your cloud account.</p>
            <p className="mt-1 text-muted">
              Sign in with the same email on any device to see the same portfolio. Exporting a JSON backup now and then is still a good idea.
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-5 flex gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.07] p-4 text-sm">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">Your data lives only in this browser.</p>
            <p className="mt-1 text-muted">
              {sync.configured
                ? 'Sign in to cloud sync below to use it on other devices. Until then it does not sync, and clearing site data will erase it.'
                : 'It does not sync between computers, browsers, or devices, and clearing site data will erase it. Export a backup regularly (the weekly review is a good moment), and use Import to move your portfolio to another device.'}
            </p>
          </div>
        </div>
      )}

      <SyncCard />

      <AiAccessCard />

      <Card className="mb-5">
        <CardHeader icon={<HardDrive size={15} />} title="Backup & transfer" />
        <div className="space-y-4 px-5 pb-5">
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            {[
              ['Projects', data.projects.length],
              ['Tasks', tasks],
              ['Milestones', milestones],
              ['Size', `${sizeKb} KB`],
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-raised py-3 ring-1 ring-line/60">
                <div className="text-lg font-semibold tabular-nums">{v}</div>
                <div className="text-[11px] text-faint">{l}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={doExport}>
              <Download size={15} /> Export JSON
            </Button>
            <Button onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> Import JSON…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void doImport(f);
              }}
            />
          </div>
          <p className="text-xs text-faint">
            Imports are validated before anything changes. Files from older versions are migrated automatically (current schema v{SCHEMA_VERSION}).
          </p>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader title="Preferences" />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <div>
            <span className="label">Appearance</span>
            <div className="flex rounded-lg border border-line bg-raised p-0.5">
              {(['dark', 'light', 'system'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={data.settings.theme === t}
                  onClick={() => apply((d) => updateSettings(d, { theme: t }))}
                  className={cx('flex-1 rounded-md py-1.5 text-xs font-medium capitalize', data.settings.theme === t ? 'bg-surface shadow-sm' : 'text-muted hover:text-ink')}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <NumberSetting label="Discretionary hours per week" value={data.settings.weeklyCapacity} onChange={(v) => apply((d) => updateSettings(d, { weeklyCapacity: v }))} />
          <NumberSetting label="Protected employment hours" value={data.settings.employmentHours} onChange={(v) => apply((d) => updateSettings(d, { employmentHours: v }))} />
          <NumberSetting label="Default focus block length (hours)" value={data.settings.blockHours} step={0.25} onChange={(v) => apply((d) => updateSettings(d, { blockHours: v }))} />
        </div>
      </Card>

      <Card>
        <CardHeader icon={<RotateCcw size={15} />} title="Recovery" />
        <div className="space-y-3 px-5 pb-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!backupRaw} onClick={restoreBackup}>
              Restore automatic backup
            </Button>
            <span className="text-xs text-faint">
              {backupRaw ? `Taken before the last import/reset${safeDate(backupRaw)}` : 'No automatic backup yet — one is made before every import or reset.'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="danger" onClick={resetSeed}>
              Restore original seed data
            </Button>
            <span className="text-xs text-faint">Replaces everything with the initial project snapshot.</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function safeDate(raw: string) {
  try {
    const d = JSON.parse(raw);
    const latest = (d.activity?.[0]?.at as string) ?? d.seededAt;
    return latest ? ` · last change ${formatTimestamp(latest)}` : '';
  } catch {
    return '';
  }
}

function NumberSetting({ label, value, onChange, step = 0.5 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label>
      <span className="label">{label}</span>
      <input type="number" min={0} step={step} className="field" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
    </label>
  );
}
