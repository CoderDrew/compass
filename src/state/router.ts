import { useEffect, useState } from 'react';

// Minimal hash router — works on GitHub Pages without server rewrites.
export type View = 'dashboard' | 'portfolio' | 'project' | 'plan' | 'review' | 'activity' | 'data';

export interface Route {
  view: View;
  param?: string;
}

const VIEWS: View[] = ['dashboard', 'portfolio', 'project', 'plan', 'review', 'activity', 'data'];

export function parseHash(hash: string): Route {
  const [view, param] = hash.replace(/^#\/?/, '').split('/');
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
