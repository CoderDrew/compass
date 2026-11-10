// Cloud sync (Supabase). This browser's copy stays the working copy; the cloud is kept in
// step with it. Local edits are pushed a moment after you stop typing, and the cloud is
// checked when the app opens, regains focus, comes back online, and every minute while visible.

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppData } from '../data/types';
import { formatTimestamp } from '../lib/dates';
import { CloudConflict, cloudConfigured, fetchRemote, getClient, insertRemote, updateRemote } from '../lib/cloud';
import { BACKUP_KEY, backupCurrent, parseAppData } from '../lib/storage';
import { clearMeta, deviceLabel, isPristineSeed, planSync, readMeta, sameData, writeMeta, type RemoteRow, type SyncMeta } from '../lib/sync';
import { useStore } from './store';

export type SyncStatus = 'off' | 'signed-out' | 'connecting' | 'syncing' | 'pending' | 'synced' | 'offline' | 'needs-choice' | 'error';

interface SyncValue {
  configured: boolean;
  status: SyncStatus;
  email: string | null;
  lastSyncedAt: string | null;
  error: string | null;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => void;
}

const Ctx = createContext<SyncValue | null>(null);
const kv = window.localStorage;
const PUSH_DELAY = 1500;
const POLL_MS = 60_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const { data, applyExternal, isExternal, choose, showToast } = useStore();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SyncStatus>(cloudConfigured ? 'connecting' : 'off');
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => readMeta(kv)?.lastSyncedAt ?? null);

  const client = useRef<SupabaseClient | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const userId = session?.user.id ?? null;
  const userRef = useRef<string | null>(null);
  userRef.current = userId;
  const running = useRef(false);
  const again = useRef(false);
  const editSeq = useRef(0);
  const pushTimer = useRef<number>();

  // --- Auth -------------------------------------------------------------------------------
  useEffect(() => {
    if (!cloudConfigured) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    getClient()
      .then(async (c) => {
        if (cancelled) return;
        client.current = c;
        const { data: s } = await c.auth.getSession();
        setSession(s.session);
        if (!s.session) setStatus('signed-out');
        unsub = c.auth.onAuthStateChange((_e, s2) => {
          setSession(s2);
          if (!s2) setStatus('signed-out');
        }).data.subscription.unsubscribe;
        // Clean the ?code=… left by an emailed sign-in link.
        const url = new URL(window.location.href);
        if (url.searchParams.has('code')) {
          url.searchParams.delete('code');
          window.history.replaceState(null, '', url.toString());
        }
      })
      .catch((e) => {
        setStatus('error');
        setError((e as Error).message);
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // --- Core sync --------------------------------------------------------------------------
  const metaFor = (uid: string): SyncMeta => {
    const m = readMeta(kv);
    return m && m.userId === uid ? m : { userId: uid, revision: null, dirty: true };
  };

  const finish = (uid: string, revision: number, dirty: boolean) => {
    const at = new Date().toISOString();
    writeMeta(kv, { userId: uid, revision, dirty, lastSyncedAt: at });
    setLastSyncedAt(at);
    setError(null);
    setStatus(dirty ? 'pending' : 'synced');
  };

  const push = async (c: SupabaseClient, uid: string, base: number | null) => {
    const seq = editSeq.current;
    const snapshot = dataRef.current;
    const row = base === null ? await insertRemote(c, uid, snapshot, deviceLabel()) : await updateRemote(c, uid, snapshot, base, deviceLabel());
    const stillDirty = editSeq.current !== seq;
    finish(uid, row.revision, stillDirty);
    if (stillDirty) schedulePush();
  };

  const describe = (d: AppData) => `${d.projects.length} projects, ${d.activity.length} activity entries`;

  const askWhichCopy = async (remote: RemoteRow, cloud: AppData, kind: 'first-link' | 'conflict') => {
    const local = dataRef.current;
    const when = `${formatTimestamp(remote.updated_at)}${remote.device ? ` from ${remote.device}` : ''}`;
    return choose({
      title: kind === 'conflict' ? 'Both copies changed' : 'Connect this device',
      body: (
        <div className="space-y-2">
          <p>
            {kind === 'conflict'
              ? 'This device has changes that were not synced, and the cloud copy was also changed on another device. Pick which to keep — they are not merged.'
              : 'Your cloud copy and this browser have different data. Pick which to keep on both.'}
          </p>
          <ul className="space-y-1 rounded-lg bg-raised p-3 text-xs ring-1 ring-line/60">
            <li>
              <b className="text-ink">Cloud:</b> {describe(cloud)} · saved {when}
            </li>
            <li>
              <b className="text-ink">This browser:</b> {describe(local)}
            </li>
          </ul>
          <p className="text-xs">The copy you don't pick is kept as this browser's automatic backup (Data &amp; settings → Restore automatic backup).</p>
        </div>
      ),
      choices: [
        { value: 'local', label: 'Keep this browser’s', variant: 'secondary' },
        { value: 'cloud', label: 'Use cloud copy', variant: 'primary' },
      ],
    });
  };

  const runOnce = async () => {
    const c = client.current;
    const uid = userRef.current;
    if (!c || !uid) return;
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }
    setStatus('syncing');
    const seqAtFetch = editSeq.current;
    const remote = await fetchRemote(c, uid);
    if (userRef.current !== uid) return;
    const meta = metaFor(uid);
    let cloud: AppData | null = null;
    if (remote) {
      try {
        cloud = parseAppData(JSON.stringify(remote.data));
      } catch (e) {
        throw new Error(`Cloud copy could not be read: ${(e as Error).message}`);
      }
    }
    const local = dataRef.current;
    let plan = planSync(meta, remote, cloud ? sameData(local, cloud) : false);
    // A fresh browser with only the starter data simply takes the cloud copy.
    if (plan === 'first-link' && isPristineSeed(local)) plan = 'pull';

    switch (plan) {
      case 'noop':
        finish(uid, remote!.revision, false);
        return;
      case 'adopt':
        finish(uid, remote!.revision, editSeq.current !== seqAtFetch);
        return;
      case 'upload-first':
        await push(c, uid, null);
        return;
      case 'push':
        await push(c, uid, meta.revision);
        return;
      case 'pull':
        if (editSeq.current !== seqAtFetch) {
          again.current = true; // edited while fetching; re-evaluate
          return;
        }
        if (meta.revision === null) backupCurrent(kv);
        applyExternal(cloud!);
        finish(uid, remote!.revision, false);
        return;
      case 'first-link':
      case 'conflict': {
        setStatus('needs-choice');
        const pick = await askWhichCopy(remote!, cloud!, plan);
        if (userRef.current !== uid) return;
        if (pick === 'cloud') {
          backupCurrent(kv);
          applyExternal(cloud!);
          finish(uid, remote!.revision, false);
          showToast('Using the cloud copy');
        } else if (pick === 'local') {
          kv.setItem(BACKUP_KEY, JSON.stringify(cloud));
          await push(c, uid, remote!.revision);
          showToast('Cloud updated from this browser');
        } else {
          setStatus('needs-choice'); // dismissed: stay paused until "Sync now"
        }
        return;
      }
    }
  };

  const runSync = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        try {
          await runOnce();
        } catch (e) {
          if (e instanceof CloudConflict) {
            again.current = true;
            continue;
          }
          const msg = (e as Error).message || 'Sync failed';
          const offline = !navigator.onLine || /fetch|network/i.test(msg);
          setStatus(offline ? 'offline' : 'error');
          setError(offline ? null : msg);
        }
      } while (again.current);
    } finally {
      running.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function schedulePush() {
    window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => void runSync(), PUSH_DELAY);
  }

  // Sync on sign-in.
  useEffect(() => {
    if (userId) void runSync();
  }, [userId, runSync]);

  // Local edits → mark dirty and push shortly.
  useEffect(() => {
    if (isExternal(data)) return;
    editSeq.current += 1;
    const uid = userRef.current;
    if (!uid) return;
    const m = metaFor(uid);
    writeMeta(kv, { ...m, dirty: true });
    setStatus((s) => (s === 'needs-choice' || s === 'offline' ? s : 'pending'));
    schedulePush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Re-check on focus/visibility/online, and poll while visible.
  useEffect(() => {
    if (!userId) return;
    let last = 0;
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 5000) return;
      last = Date.now();
      void runSync();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden' && readMeta(kv)?.dirty) void runSync();
    };
    const id = window.setInterval(check, POLL_MS);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [userId, runSync]);

  // --- Public API -------------------------------------------------------------------------
  const sendCode = async (email: string) => {
    const c = await getClient();
    const { error: err } = await c.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    if (err) throw new Error(err.message);
  };

  const verifyCode = async (email: string, code: string) => {
    const c = await getClient();
    const { error: err } = await c.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
    if (err) throw new Error(err.message);
  };

  const signOut = async () => {
    const c = await getClient();
    window.clearTimeout(pushTimer.current);
    await c.auth.signOut();
    clearMeta(kv);
    setLastSyncedAt(null);
    setStatus('signed-out');
  };

  const value: SyncValue = {
    configured: cloudConfigured,
    status,
    email: session?.user.email ?? null,
    lastSyncedAt,
    error,
    sendCode,
    verifyCode,
    signOut,
    syncNow: () => void runSync(),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSync(): SyncValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync must be used inside SyncProvider');
  return v;
}
