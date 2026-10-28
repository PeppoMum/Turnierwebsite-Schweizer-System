// Hash-Routing, damit GitHub Pages keine Server-Umleitungen braucht.
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'create' }
  | { name: 'admin'; id: string; tab: AdminTab }
  | { name: 'public'; id: string; tab: PublicTab }
  | { name: 'invite'; tid: string; inviteId: string }
  | { name: 'helper'; tid: string; linkId: string }
  | { name: 'notFound' };

export type AdminTab = 'live' | 'spielplan' | 'tabelle' | 'teams' | 'einstellungen';
export type PublicTab = 'aktuell' | 'spielplan' | 'team' | 'tabelle';

const ADMIN_TABS: AdminTab[] = ['live', 'spielplan', 'tabelle', 'teams', 'einstellungen'];
const PUBLIC_TABS: PublicTab[] = ['aktuell', 'spielplan', 'team', 'tabelle'];

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+|\/+$/g, '');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { name: 'dashboard' };
  if (parts[0] === 'neu' && parts.length === 1) return { name: 'create' };
  if (parts[0] === 'turnier' && parts[1]) {
    const tab = (parts[2] ?? 'live') as AdminTab;
    return ADMIN_TABS.includes(tab) ? { name: 'admin', id: parts[1], tab } : { name: 'notFound' };
  }
  if (parts[0] === 't' && parts[1]) {
    const tab = (parts[2] ?? 'aktuell') as PublicTab;
    return PUBLIC_TABS.includes(tab) ? { name: 'public', id: parts[1], tab } : { name: 'notFound' };
  }
  if (parts[0] === 'helfer' && parts[1] && parts[2] && parts.length === 3) return { name: 'helper', tid: parts[1], linkId: parts[2] };
  if (parts[0] === 'einladung' && parts[1] && parts[2] && parts.length === 3) return { name: 'invite', tid: parts[1], inviteId: parts[2] };
  return { name: 'notFound' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'dashboard':
      return '#/';
    case 'create':
      return '#/neu';
    case 'admin':
      return `#/turnier/${encodeURIComponent(route.id)}${route.tab === 'live' ? '' : `/${route.tab}`}`;
    case 'public':
      return `#/t/${encodeURIComponent(route.id)}${route.tab === 'aktuell' ? '' : `/${route.tab}`}`;
    case 'invite':
      return `#/einladung/${encodeURIComponent(route.tid)}/${encodeURIComponent(route.inviteId)}`;
    case 'helper':
      return `#/helfer/${encodeURIComponent(route.tid)}/${encodeURIComponent(route.linkId)}`;
    default:
      return '#/';
  }
}

/** Vollständige öffentliche Adresse für Link und QR-Code. */
export function publicUrl(id: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${href({ name: 'public', id, tab: 'aktuell' })}`;
}

/** Vollständige Adresse des Helferlinks ohne Anmeldung. */
export function helperUrl(tid: string, linkId: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${href({ name: 'helper', tid, linkId })}`;
}

export function navigate(route: Route): void {
  window.location.hash = href(route).slice(1);
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseHash(hash);
}
