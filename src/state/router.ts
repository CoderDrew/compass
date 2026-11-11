import { useEffect, useState } from 'react';

// Minimal hash router — works on GitHub Pages without server rewrites.
export type View = 'dashboard' | 'portfolio' | 'project' | 'plan' | 'review' | 'activity' | 'data' | 'oauth';

export interface Route {
  view: View;
  param?: string;
}

const VIEWS: View[] = ['dashboard', 'portfolio', 'project', 'plan', 'review', 'activity', 'data', 'oauth'];

export function parseHash(hash: string): Route {
  const [view, param] = hash.replace(/^#\/?/, '').split('?')[0].split('/');
  if (!view) return { view: 'dashboard' };
  return VIEWS.includes(view as View) ? { view: view as View, param: param ? decodeURIComponent(param) : undefined } : { view: 'dashboard' };
}

export function href(view: View, param?: string): string {
  return view === 'dashboard' ? '#/' : `#/${view}${param ? `/${encodeURIComponent(param)}` : ''}`;
}

export function navigate(view: View, param?: string) {
  window.location.hash = href(view, param);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/**
 * Supabase's OAuth server sends the user to `<site>/oauth/consent?authorization_id=…`.
 * Capture that id (from the query string or the forwarding page) and switch to the hash
 * route, so it works under GitHub Pages' repo path and after the sign-in email round trip.
 */
export function captureOAuthRedirect(remember: (id: string) => boolean, pending: () => string | null): void {
  const url = new URL(window.location.href);
  const id = url.searchParams.get('authorization_id');
  if (id && remember(id)) {
    url.searchParams.delete('authorization_id');
    window.history.replaceState(null, '', `${url.pathname}${url.search}#/oauth/consent`);
    return;
  }
  if (pending() && !window.location.hash.startsWith('#/oauth')) window.history.replaceState(null, '', `${url.pathname}${url.search}#/oauth/consent`);
}
