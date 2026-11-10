import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppData } from '../data/types';
import { weekStartOf } from '../lib/dates';
import { getWeek } from '../lib/ops';
import { EMPTY_FILTERS, type Filters } from '../lib/selectors';
import { loadData, saveData, STORAGE_KEY } from '../lib/storage';

interface Toast {
  id: number;
  text: string;
  undo?: AppData;
}

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Informational: only a single acknowledge button. */
  info?: boolean;
}

interface StoreValue {
  data: AppData;
  /** Apply a pure operation. Pass `toast` to show a message; `undoable` lets the user revert. */
  apply: (fn: (d: AppData) => AppData, opts?: { toast?: string; undoable?: boolean }) => void;
  replaceData: (d: AppData, toast?: string) => void;
  filters: Filters;
  setFilters: (f: Filters | ((f: Filters) => Filters)) => void;
  today: Date;
  currentWeek: string;
  focusIds: string[];
  toast: Toast | null;
  showToast: (text: string, undo?: AppData) => void;
  dismissToast: () => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  confirmState: (ConfirmOptions & { resolve: (v: boolean) => void }) | null;
  loadNotice: string | null;
  storageError: string | null;
}

const Ctx = createContext<StoreValue | null>(null);

const kv = typeof window !== 'undefined' ? window.localStorage : undefined;

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => (kv ? loadData(kv) : null), []);
  const [data, setData] = useState<AppData>(initial!.data);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmState, setConfirmState] = useState<StoreValue['confirmState']>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [today, setToday] = useState(() => new Date());
  const skipSave = useRef(false);
  const toastTimer = useRef<number>();
  const loadNotice =
    initial?.source === 'recovered'
      ? `Saved data could not be read (${initial.error}). The original was preserved in browser storage and the seed dataset was loaded.`
      : null;

  // Persist every change.
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    try {
      if (kv) saveData(kv, data);
      setStorageError(null);
    } catch (e) {
      setStorageError(`Could not save to browser storage: ${(e as Error).message}. Export a backup now.`);
    }
  }, [data]);

  // Keep multiple tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue || !kv) return;
      const res = loadData(kv);
      if (res.source === 'stored') {
        skipSave.current = true;
        setData(res.data);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Roll "today" over at midnight / when the tab regains focus.
  useEffect(() => {
    const refresh = () => setToday((t) => (new Date().toDateString() === t.toDateString() ? t : new Date()));
    const id = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  // Theme.
  useEffect(() => {
    const t = data.settings.theme;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const set = () => {
      const dark = t === 'dark' || (t === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b0d' : '#f5f5f7');
    };
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, [data.settings.theme]);

  const showToast = useCallback((text: string, undo?: AppData) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), undo ? 6000 : 2800);
  }, []);

  const apply = useCallback<StoreValue['apply']>(
    (fn, opts) => {
      setData((prev) => {
        const next = fn(prev);
        if (opts?.toast) queueMicrotask(() => showToast(opts.toast!, opts.undoable ? prev : undefined));
        return next;
      });
    },
    [showToast],
  );

  const replaceData = useCallback((d: AppData, msg?: string) => {
    setData(d);
    if (msg) showToast(msg);
  }, [showToast]);

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setConfirmState({
          ...o,
          resolve: (v) => {
            setConfirmState(null);
            resolve(v);
          },
        }),
      ),
    [],
  );

  const currentWeek = weekStartOf(today);
  const focusIds = getWeek(data, currentWeek).focusProjectIds;

  const value: StoreValue = {
    data,
    apply,
    replaceData,
    filters,
    setFilters,
    today,
    currentWeek,
    focusIds,
    toast,
    showToast,
    dismissToast: () => setToast(null),
    confirm,
    confirmState,
    loadNotice,
    storageError,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside StoreProvider');
  return v;
}
