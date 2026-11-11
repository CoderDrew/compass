import { AlertTriangle, Check, Cloud, CloudOff, LogOut, Mail, RefreshCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { timeAgo } from '../lib/dates';
import { href } from '../state/router';
import { useStore } from '../state/store';
import { useSync, type SyncStatus } from '../state/sync';
import { Button, Card, CardHeader, cx } from './ui';

const LABEL: Record<SyncStatus, string> = {
  off: 'Saved in this browser only',
  'signed-out': 'Sync is off — sign in',
  connecting: 'Connecting…',
  syncing: 'Syncing…',
  pending: 'Saving…',
  synced: 'Synced',
  offline: 'Offline — changes kept here',
  'needs-choice': 'Sync paused — choose a copy',
  error: 'Sync error',
};

export function SyncIcon({ status, size = 14 }: { status: SyncStatus; size?: number }) {
  switch (status) {
    case 'synced':
      return <Check size={size} className="text-emerald-500" />;
    case 'syncing':
    case 'pending':
    case 'connecting':
      return <RefreshCw size={size} className="animate-spin text-accent [animation-duration:1.6s]" />;
    case 'offline':
    case 'off':
    case 'signed-out':
      return <CloudOff size={size} className="text-faint" />;
    default:
      return <AlertTriangle size={size} className="text-amber-500" />;
  }
}

/** Short status line for the sidebar. */
export function SyncStatusLine() {
  const { status, lastSyncedAt } = useSync();
  useTick(30_000);
  const text = status === 'synced' && lastSyncedAt ? `Synced ${timeAgo(lastSyncedAt, new Date()) || 'just now'}` : LABEL[status];
  return (
    <a href={href('data')} className="flex items-center gap-2 text-[11px] leading-relaxed text-faint hover:text-muted">
      <SyncIcon status={status} size={13} />
      <span>{text}</span>
    </a>
  );
}

/** Mobile header button: icon reflects sync state. */
export function SyncHeaderButton() {
  const { status } = useSync();
  return (
    <a href={href('data')} aria-label={`Data & sync: ${LABEL[status]}`} title={LABEL[status]} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-line/40">
      {status === 'off' || status === 'signed-out' ? <Cloud size={16} /> : <SyncIcon status={status} size={16} />}
    </a>
  );
}

/** Card on the Data & settings page: sign in, status, sync now, sign out. */
export function SyncCard() {
  const sync = useSync();
  const { confirm } = useStore();

  if (!sync.configured) {
    return (
      <Card className="mb-5">
        <CardHeader icon={<Cloud size={15} />} title="Cloud sync" />
        <div className="space-y-2 px-5 pb-5 text-sm text-muted">
          <p>Cloud sync isn't set up for this build, so data stays in this browser.</p>
          <p className="text-xs text-faint">
            To turn it on, create a free Supabase project and add its URL and anon key as <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code> — see
            “Cloud sync setup” in the README.
          </p>
        </div>
      </Card>
    );
  }

  const signedIn = !!sync.email;

  const signOut = async () => {
    const unsynced = sync.status === 'pending' || sync.status === 'offline' || sync.status === 'needs-choice' || sync.status === 'error';
    const ok = await confirm({
      title: 'Sign out of cloud sync?',
      body: unsynced
        ? 'Some changes on this device have not reached the cloud yet. They stay in this browser, but other devices won’t see them until you sign in here again.'
        : 'Your data stays in this browser and in the cloud. This device just stops syncing until you sign in again.',
      confirmLabel: 'Sign out',
      danger: unsynced,
    });
    if (ok) await sync.signOut();
  };

  return (
    <Card className="mb-5">
      <CardHeader icon={<Cloud size={15} />} title="Cloud sync" />
      <div className="space-y-4 px-5 pb-5 text-sm">
        {signedIn ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-xs font-medium ring-1 ring-line/60">
                <SyncIcon status={sync.status} size={13} />
                {LABEL[sync.status]}
              </span>
              <span className="text-xs text-faint">
                Signed in as <b className="font-medium text-muted">{sync.email}</b>
                {sync.lastSyncedAt && ` · last synced ${timeAgo(sync.lastSyncedAt, new Date()) || 'just now'}`}
              </span>
            </div>
            {sync.error && <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{sync.error}</p>}
            {sync.status === 'needs-choice' && <p className="text-xs text-muted">Sync is paused until you pick which copy to keep. Press Sync now to choose.</p>}
            <div className="flex flex-wrap gap-2">
              <Button onClick={sync.syncNow} disabled={sync.status === 'syncing'}>
                <RefreshCw size={15} /> Sync now
              </Button>
              <Button variant="ghost" onClick={signOut}>
                <LogOut size={15} /> Sign out
              </Button>
            </div>
            <p className="text-xs text-faint">
              Changes save to the cloud a moment after you make them, and other devices pick them up when you switch back to them. Each browser still keeps a working
              copy, so the app works offline and catches up when you reconnect.
            </p>
          </>
        ) : (
          <SignInForm />
        )}
      </div>
    </Card>
  );
}

export function SignInForm() {
  const sync = useSync();
  const [email, setEmail] = useState(() => localStorage.getItem('project-compass:last-email') ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ReactNode>(null);

  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return setMsg('Enter a valid email address.');
    setBusy(true);
    setMsg(null);
    try {
      await sync.sendCode(email.trim());
      localStorage.setItem('project-compass:last-email', email.trim());
      setSent(true);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await sync.verifyCode(email.trim(), code);
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-muted">Sign in to keep this portfolio in sync across your devices. No password — you get a sign-in link by email.</p>
      {!sent ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input type="email" required autoComplete="email" placeholder="you@example.com" className="field min-w-0 flex-1 basis-56" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" variant="primary" disabled={busy}>
            <Mail size={15} /> Email me a link
          </Button>
        </form>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p className="text-xs text-muted">
            Sent to <b>{email}</b>. Open the link in the email <b>in this same browser</b> and you'll be signed in. If your email shows a code instead, enter it here.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Code"
              className="field w-36 font-mono tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
            <Button type="submit" variant="primary" disabled={busy || code.length < 6}>
              Sign in
            </Button>
            <Button variant="ghost" onClick={() => (setSent(false), setCode(''), setMsg(null))}>
              Use a different email
            </Button>
          </div>
        </form>
      )}
      {msg && <p className={cx('text-xs', 'text-amber-600 dark:text-amber-300')}>{msg}</p>}
    </div>
  );
}

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}
