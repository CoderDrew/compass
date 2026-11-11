import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { AlertTriangle, Bot, Check, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SignInForm } from '../components/SyncPanel';
import { Button, Card, PageHeader } from '../components/ui';
import { approveClient, checkRedirect, clearPending, readPending } from '../lib/aiAccess';
import { fetchAiSettings, getClient, saveAiSettings } from '../lib/cloud';
import { href, navigate } from '../state/router';
import { useSync } from '../state/sync';

type State =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'redirecting'; message: string }
  | { kind: 'ready'; details: OAuthAuthorizationDetails; accessOn: boolean | null };

/**
 * OAuth consent screen for AI assistants (Supabase OAuth 2.1 server, "Authorization Path").
 * The user must be signed in to Compass; approving also adds the assistant to the
 * approved list that the MCP server checks on every request.
 */
export function OAuthConsent() {
  const sync = useSync();
  const [authId] = useState(() => readPending(localStorage));
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [enable, setEnable] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authId) return setState({ kind: 'none' });
    if (!sync.configured || !sync.userId) return;
    let cancelled = false;
    (async () => {
      try {
        const c = await getClient();
        const { data, error } = await c.auth.oauth.getAuthorizationDetails(authId);
        if (cancelled) return;
        if (error || !data) throw new Error(error?.message ?? 'This approval request has expired. Start connecting again from your assistant.');
        if (!('authorization_id' in data)) {
          // Already approved earlier: go straight back to the assistant.
          clearPending(localStorage);
          setState({ kind: 'redirecting', message: 'Already approved. Returning to your assistant…' });
          window.location.assign(data.redirect_url);
          return;
        }
        if (data.user.id !== sync.userId) throw new Error(`This request is for ${data.user.email}, but you're signed in to Compass as ${sync.email}.`);
        const s = await fetchAiSettings(c, sync.userId);
        if (!cancelled) setState({ kind: 'ready', details: data, accessOn: s ? s.ai_access_enabled : null });
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authId, sync.configured, sync.userId, sync.email]);

  const finish = async (approve: boolean) => {
    if (state.kind !== 'ready' || !sync.userId) return;
    setBusy(true);
    try {
      const c = await getClient();
      const { details } = state;
      if (approve) {
        const current = await fetchAiSettings(c, sync.userId);
        if (!current) throw new Error('AI access isn’t set up on this Supabase project yet.');
        await saveAiSettings(c, sync.userId, approveClient(current, details.client.id, details.client.name, enable));
      }
      const { data, error } = approve
        ? await c.auth.oauth.approveAuthorization(details.authorization_id, { skipBrowserRedirect: true })
        : await c.auth.oauth.denyAuthorization(details.authorization_id, { skipBrowserRedirect: true });
      if (error || !data) throw new Error(error?.message ?? 'Could not complete the request.');
      clearPending(localStorage);
      setState({ kind: 'redirecting', message: approve ? `Approved. Returning to ${details.client.name}…` : 'Denied. Returning…' });
      window.location.assign(data.redirect_url);
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
      setBusy(false);
    }
  };

  const cancel = () => {
    clearPending(localStorage);
    navigate('data');
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Connect an AI assistant" subtitle="An assistant is asking to work with your Compass portfolio." />
      <Card className="p-5 text-sm">
        {!sync.configured ? (
          <p className="text-muted">Cloud sync isn't set up for this build, so assistants can't connect.</p>
        ) : state.kind === 'none' ? (
          <p className="text-muted">
            There's nothing to approve right now. Start connecting from your assistant, and it will bring you back here. <a className="text-accent hover:underline" href={href('data')}>Data &amp; settings</a>
          </p>
        ) : !sync.userId ? (
          <div className="space-y-3">
            <p className="font-medium">Sign in to Compass to continue.</p>
            <SignInForm />
            <p className="text-xs text-faint">After signing in (here or from the email link), you'll come back to this approval.</p>
          </div>
        ) : state.kind === 'loading' ? (
          <p className="text-faint">Loading request…</p>
        ) : state.kind === 'redirecting' ? (
          <p className="flex items-center gap-2 text-muted">
            <Check size={16} className="text-emerald-500" /> {state.message}
          </p>
        ) : state.kind === 'error' ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {state.message}
            </p>
            <Button onClick={cancel}>Back to Compass</Button>
          </div>
        ) : (
          <Ready state={state} enable={enable} setEnable={setEnable} busy={busy} email={sync.email} onApprove={() => finish(true)} onDeny={() => finish(false)} />
        )}
      </Card>
    </div>
  );
}

function Ready({
  state,
  enable,
  setEnable,
  busy,
  email,
  onApprove,
  onDeny,
}: {
  state: Extract<State, { kind: 'ready' }>;
  enable: boolean;
  setEnable: (v: boolean) => void;
  busy: boolean;
  email: string | null;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const { details, accessOn } = state;
  const redirect = checkRedirect(details.redirect_uri);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Bot size={20} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{details.client.name || 'Unnamed app'}</p>
          <p className="truncate text-xs text-faint">
            Returns to {redirect.ok ? redirect.host : details.redirect_uri} · signed in as {email}
          </p>
        </div>
      </div>

      {!redirect.ok ? (
        <p className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {redirect.reason} Deny this request.
        </p>
      ) : (
        !redirect.known && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> This isn't a return address Compass recognises ({redirect.host}). Only approve if you started this connection yourself, just now.
          </p>
        )
      )}

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 font-medium">
          <ShieldCheck size={15} className="text-emerald-500" /> If you approve, it can:
        </p>
        <ul className="ml-5 list-disc space-y-0.5 text-muted">
          <li>read your projects, tasks, milestones, week plans and activity</li>
          <li>log notes and decisions; add and update tasks and milestones</li>
          <li>update next actions, blockers and notes; plan your week</li>
        </ul>
        <p className="mt-2 flex items-center gap-1.5 font-medium">
          <X size={15} className="text-faint" /> It can't:
        </p>
        <ul className="ml-5 list-disc space-y-0.5 text-muted">
          <li>delete anything, or change statuses, priorities or deadlines</li>
        </ul>
        <p className="mt-2 text-xs text-faint">Every change appears in Activity as “via {details.client.name || 'assistant'}”. Disconnect it any time in Data &amp; settings.</p>
      </div>

      {accessOn === false && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enable} onChange={(e) => setEnable(e.target.checked)} />
          Turn on AI access (currently off)
        </label>
      )}
      {accessOn === null && <p className="text-xs text-amber-700 dark:text-amber-300">AI access isn't set up on this Supabase project yet, so approving will fail.</p>}

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" disabled={busy} onClick={onDeny}>
          Deny
        </Button>
        <Button variant="primary" disabled={busy || !redirect.ok || accessOn === null} onClick={onApprove}>
          Approve
        </Button>
      </div>
    </div>
  );
}
