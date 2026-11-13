import { CalendarRange, ClipboardCheck, Compass, Database, History, LayoutGrid, Moon, NotebookPen, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { href, type View } from '../state/router';
import { useStore } from '../state/store';
import { updateSettings } from '../lib/ops';
import { SyncHeaderButton, SyncStatusLine } from './SyncPanel';
import { Button, cx, Modal } from './ui';

const NAV: { view: View; label: string; icon: ReactNode; mobile?: string }[] = [
  { view: 'dashboard', label: 'Today', icon: <Compass size={18} />, mobile: 'Today' },
  { view: 'portfolio', label: 'Portfolio', icon: <LayoutGrid size={18} />, mobile: 'Portfolio' },
  { view: 'plan', label: 'Plan week', icon: <CalendarRange size={18} />, mobile: 'Plan' },
  { view: 'review', label: 'Weekly review', icon: <ClipboardCheck size={18} />, mobile: 'Review' },
  { view: 'journal', label: 'Journal', icon: <NotebookPen size={18} />, mobile: 'Journal' },
  { view: 'activity', label: 'Activity', icon: <History size={18} />, mobile: 'Activity' },
  { view: 'data', label: 'Data & settings', icon: <Database size={18} />, mobile: 'Settings' },
];

export function Shell({ view, children }: { view: View; children: ReactNode }) {
  const { data, apply, toast, dismissToast, replaceData, dialog, loadNotice, storageError } = useStore();
  const theme = data.settings.theme;
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const active = view === 'project' ? 'portfolio' : view;

  return (
    <div className="min-h-screen lg:pl-60">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line/70 bg-surface/60 px-3 py-5 backdrop-blur-xl lg:flex">
        <a href={href('dashboard')} className="mb-6 flex items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-white shadow-sm">
            <Compass size={18} strokeWidth={2.2} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Project Compass</span>
        </a>
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {NAV.map((n) => (
            <a
              key={n.view}
              href={href(n.view)}
              aria-current={active === n.view ? 'page' : undefined}
              className={cx(
                'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                active === n.view ? 'bg-accent/10 text-ink' : 'text-muted hover:bg-line/40 hover:text-ink',
              )}
            >
              <span className={active === n.view ? 'text-accent' : ''}>{n.icon}</span>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-2">
          <SyncStatusLine />
          <button
            type="button"
            onClick={() => apply((d) => updateSettings(d, { theme: dark ? 'light' : 'dark' }))}
            className="flex items-center gap-2 text-xs font-medium text-muted hover:text-ink"
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line/60 bg-bg/80 px-4 py-3 backdrop-blur-xl lg:hidden">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
          <Compass size={16} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight">Project Compass</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={() => apply((d) => updateSettings(d, { theme: dark ? 'light' : 'dark' }))}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-line/40"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <SyncHeaderButton />
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-9">
        {(loadNotice || storageError) && (
          <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">{storageError ?? loadNotice}</div>
        )}
        {children}
      </main>

      {/* Mobile tab bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t border-line/70 bg-surface/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {NAV.filter((n) => n.mobile).map((n) => (
          <a
            key={n.view}
            href={href(n.view)}
            aria-current={active === n.view ? 'page' : undefined}
            className={cx('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', active === n.view ? 'text-accent' : 'text-faint')}
          >
            {n.icon}
            {n.mobile}
          </a>
        ))}
      </nav>

      {/* Toast */}
      {toast && (
        <div key={toast.id} role="status" className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 animate-fade-up items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm text-bg shadow-pop lg:bottom-6">
          {toast.text}
          {toast.undo && (
            <button
              type="button"
              className="font-semibold text-accent"
              onClick={() => {
                replaceData(toast.undo!);
                dismissToast();
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}

      {/* Confirm / choice dialog */}
      <Modal
        open={!!dialog}
        onClose={() => dialog?.resolve(null)}
        title={dialog?.title ?? ''}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            {dialog?.choices.map((c, i, all) => (
              <Button key={c.value} data-autofocus={i === all.length - 1 ? true : undefined} variant={c.variant ?? 'secondary'} onClick={() => dialog.resolve(c.value)}>
                {c.label}
              </Button>
            ))}
          </div>
        }
      >
        <div className="text-sm text-muted">{dialog?.body}</div>
      </Modal>
    </div>
  );
}
