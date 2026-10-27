import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { MockTournamentStore } from './mockStore';
import type { TournamentService } from './service';
import type { AuthService, AuthUser } from './auth';

const ServiceContext = createContext<TournamentService | null>(null);
const AuthContext = createContext<AuthService | null>(null);

let defaultService: TournamentService | null = null;
function getDefaultService(): TournamentService {
  defaultService ??= new MockTournamentStore();
  return defaultService;
}

export function ServiceProvider({ service, auth, children }: { service?: TournamentService; auth?: AuthService; children: ReactNode }) {
  return (
    <ServiceContext.Provider value={service ?? getDefaultService()}>
      <AuthContext.Provider value={auth ?? null}>{children}</AuthContext.Provider>
    </ServiceContext.Provider>
  );
}

/** null, wenn die App ohne Anmeldung läuft (Beispieldaten). */
export function useAuthService(): AuthService | null {
  return useContext(AuthContext);
}

/** Angemeldete Person; undefined, solange noch geprüft wird. Ohne AuthService gilt die App als freigeschaltet. */
export function useAuthUser(): AuthUser | null | undefined {
  const a = useAuthService();
  const subscribe = useCallback((cb: () => void) => (a ? a.subscribe(cb) : () => undefined), [a]);
  return useSyncExternalStore(subscribe, () => (a ? (a.isReady() ? a.current() : undefined) : NO_AUTH_USER));
}

export const NO_AUTH_USER: AuthUser = { uid: 'local', email: null };

export function useService(): TournamentService {
  const s = useContext(ServiceContext);
  if (!s) throw new Error('ServiceProvider fehlt');
  return s;
}

export function useTournaments() {
  const s = useService();
  return useSyncExternalStore(s.subscribe, s.getAll);
}

export function useTournament(id: string) {
  const s = useService();
  return useSyncExternalStore(s.subscribe, () => s.get(id));
}

export function usePublicTournament(id: string) {
  const s = useService();
  return useSyncExternalStore(s.subscribe, () => s.getPublic(id));
}

export function useLoading(id?: string): boolean {
  const s = useService();
  return useSyncExternalStore(s.subscribe, () => s.isLoading?.(id) ?? false);
}
