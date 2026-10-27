import './styles/tokens.css';
import './styles/app.css';
import { useEffect, type ReactNode } from 'react';
import { ServiceProvider, useAuthService, useAuthUser, useLoading, usePublicTournament, useTournament } from './data/context';
import type { AuthService } from './data/auth';
import type { TournamentService } from './data/service';
import { href, publicUrl, useRoute, type AdminTab, type PublicTab } from './router';
import { AppShell, type MoreItem, type NavItem } from './shell/AppShell';
import { applyTheme } from './theme';
import { Dashboard } from './screens/Dashboard';
import { Wizard } from './screens/wizard/Wizard';
import { AdminTournament } from './screens/admin/AdminTournament';
import { PublicTournament } from './screens/public/PublicTournament';
import { EmptyState } from './components/ui';
import { LoginScreen } from './screens/auth/LoginForm';
import { InvitationScreen } from './screens/auth/InvitationScreen';

const APP_NAME = 'Turnierplaner';

export function App({ service, auth }: { service?: TournamentService; auth?: AuthService }) {
  useEffect(() => {
    applyTheme();
  }, []);
  return (
    <ServiceProvider service={service} auth={auth}>
      <Routes />
    </ServiceProvider>
  );
}

function Routes() {
  const route = useRoute();
  const accountItems = useAccountItems();
  const routeKey = JSON.stringify(route);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [routeKey]);

  switch (route.name) {
    case 'dashboard':
    case 'create':
      return (
        <AppShell
          brand={APP_NAME}
          brandHref={href({ name: 'dashboard' })}
          items={[
            { key: 'list', label: 'Turniere', icon: 'trophy', href: href({ name: 'dashboard' }), active: route.name === 'dashboard' },
            { key: 'new', label: 'Anlegen', icon: 'plus', href: href({ name: 'create' }), active: route.name === 'create' },
          ]}
          more={accountItems}
        >
          <RequireLogin>{route.name === 'dashboard' ? <Dashboard /> : <Wizard />}</RequireLogin>
        </AppShell>
      );
    case 'admin':
      return <AdminRoute id={route.id} tab={route.tab} accountItems={accountItems} />;
    case 'invite':
      return (
        <AppShell brand={APP_NAME} brandHref="#/" items={[]}>
          <InvitationScreen tid={route.tid} inviteId={route.inviteId} />
        </AppShell>
      );
    case 'public':
      return <PublicRoute id={route.id} tab={route.tab} />;
    default:
      return (
        <AppShell brand={APP_NAME} brandHref="#/" items={[]}>
          <div className="page">
            <h1 className="page-title">Seite nicht gefunden</h1>
            <EmptyState text="Diese Adresse gibt es nicht." action={<a className="btn pri" href="#/">Zu den Turnieren</a>} />
          </div>
        </AppShell>
      );
  }
}

const ADMIN_NAV: Array<{ tab: AdminTab; label: string; icon: NavItem['icon'] }> = [
  { tab: 'live', label: 'Live', icon: 'live' },
  { tab: 'spielplan', label: 'Spielplan', icon: 'calendar' },
  { tab: 'tabelle', label: 'Tabelle', icon: 'table' },
  { tab: 'teams', label: 'Teams', icon: 'users' },
  { tab: 'einstellungen', label: 'Einstellungen', icon: 'settings' },
];

/** „Abmelden“ im Mehr-Menü, wenn jemand angemeldet ist. */
function useAccountItems(): MoreItem[] {
  const auth = useAuthService();
  const user = useAuthUser();
  if (!auth || !user) return [];
  return [{ key: 'logout', label: user.email ? `Abmelden (${user.email})` : 'Abmelden', icon: 'logout', onSelect: () => void auth.signOut() }];
}

/** Verwaltung nur mit Anmeldung, sofern die App mit Anmeldung läuft. */
function RequireLogin({ children }: { children: ReactNode }) {
  const user = useAuthUser();
  if (user === undefined) return <Loading />;
  if (user === null) return <LoginScreen />;
  return <>{children}</>;
}

function Loading() {
  return (
    <div className="page" aria-busy="true">
      <span className="muted">Lädt …</span>
    </div>
  );
}

function AdminRoute({ id, tab, accountItems }: { id: string; tab: AdminTab; accountItems: MoreItem[] }) {
  const data = useTournament(id);
  const loading = useLoading(id);
  const more: MoreItem[] = [
    { key: 'public', label: 'Öffentliche Seite', icon: 'eye', href: href({ name: 'public', id, tab: 'aktuell' }) },
    { key: 'list', label: 'Alle Turniere', icon: 'trophy', href: href({ name: 'dashboard' }) },
    ...accountItems,
  ];
  return (
    <AppShell
      brand={APP_NAME}
      brandHref={href({ name: 'dashboard' })}
      items={ADMIN_NAV.map((n) => ({
        key: n.tab,
        label: n.label,
        icon: n.icon,
        href: href({ name: 'admin', id, tab: n.tab }),
        active: n.tab === tab,
      }))}
      more={more}
    >
      <RequireLogin>
        {data ? (
          <AdminTournament data={data} tab={tab} />
        ) : loading ? (
          <Loading />
        ) : (
          <div className="page">
            <h1 className="page-title">Turnier nicht gefunden</h1>
            <EmptyState
              text="Dieses Turnier gibt es nicht, oder dein Konto hat keinen Zugriff darauf."
              action={<a className="btn pri" href="#/">Zu den Turnieren</a>}
            />
          </div>
        )}
      </RequireLogin>
    </AppShell>
  );
}

function PublicRoute({ id, tab }: { id: string; tab: PublicTab }) {
  const view = usePublicTournament(id);
  const loading = useLoading(id);
  const showTable = view?.tournament.visibility === 'full';
  const nav: Array<{ tab: PublicTab; label: string; icon: NavItem['icon'] }> = [
    { tab: 'aktuell', label: 'Aktuell', icon: 'live' },
    { tab: 'spielplan', label: 'Spielplan', icon: 'calendar' },
    { tab: 'team', label: 'Mein Team', icon: 'star' },
    ...(showTable ? [{ tab: 'tabelle' as const, label: 'Tabelle', icon: 'table' as const }] : []),
  ];
  const more: MoreItem[] = view
    ? [
        {
          key: 'share',
          label: 'Link teilen',
          icon: 'share',
          onSelect: () => {
            const url = publicUrl(id);
            if (typeof navigator.share === 'function') navigator.share({ title: view.tournament.title, url }).catch(() => undefined);
            else navigator.clipboard?.writeText(url).catch(() => undefined);
          },
        },
      ]
    : [];
  return (
    <AppShell
      brand={view?.tournament.title ?? APP_NAME}
      brandHref={href({ name: 'public', id, tab: 'aktuell' })}
      items={nav.map((n) => ({ key: n.tab, label: n.label, icon: n.icon, href: href({ name: 'public', id, tab: n.tab }), active: n.tab === tab }))}
      more={more}
    >
      {view ? (
        <PublicTournament view={view} tab={tab === 'tabelle' && !showTable ? 'aktuell' : tab} />
      ) : loading ? (
        <Loading />
      ) : (
        <div className="page">
          <h1 className="page-title">Turnier nicht gefunden</h1>
          <EmptyState text="Dieses Turnier ist nicht öffentlich oder der Link ist falsch. Frag am besten bei der Turnierleitung nach." />
        </div>
      )}
    </AppShell>
  );
}
