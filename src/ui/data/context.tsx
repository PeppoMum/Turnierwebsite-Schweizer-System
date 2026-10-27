import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { MockTournamentStore } from './mockStore';
import type { TournamentService } from './service';

const ServiceContext = createContext<TournamentService | null>(null);

let defaultService: TournamentService | null = null;
function getDefaultService(): TournamentService {
  defaultService ??= new MockTournamentStore();
  return defaultService;
}

export function ServiceProvider({ service, children }: { service?: TournamentService; children: ReactNode }) {
  return <ServiceContext.Provider value={service ?? getDefaultService()}>{children}</ServiceContext.Provider>;
}

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
