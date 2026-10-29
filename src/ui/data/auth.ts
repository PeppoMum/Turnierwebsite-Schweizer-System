// Anmeldung und Helfer-Einladungen aus Sicht der Oberfläche. Die Firebase-Umsetzung steckt in src/data
// (auth.ts, invitations.ts); ohne AuthService (Beispieldaten) braucht die App keine Anmeldung.
import type { RoleName } from '../../domain';

export interface AuthUser {
  uid: string;
  email: string | null;
}

export interface InvitationInfo {
  tournamentTitle: string;
  role: RoleName;
  /** Grund, warum die Einladung nicht mehr geht, sonst null. */
  problem: string | null;
}

export interface CreateInvitationInput {
  role: Exclude<RoleName, 'owner' | 'referee'>;
  validForHours: number;
  canPublishRounds?: boolean;
}

export interface AuthService {
  subscribe(listener: () => void): () => void;
  /** false, solange noch nicht feststeht, ob jemand angemeldet ist. */
  isReady(): boolean;
  current(): AuthUser | null;

  signInWithEmail(email: string, password: string): Promise<void>;
  registerWithEmail(email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;

  getInvitation(tid: string, inviteId: string): Promise<InvitationInfo>;
  /** Löst die Einladung mit dem angemeldeten Konto ein und liefert die Rolle. */
  redeemInvitation(tid: string, inviteId: string): Promise<RoleName>;
  /** Liefert den fertigen Einladungslink. */
  createInvitation?(tid: string, input: CreateInvitationInput): Promise<string>;
  /** Helferlink ohne Anmeldung: meldet bei Bedarf anonym an und gibt die Helferrolle. */
  joinWithHelperLink?(tid: string, linkId: string): Promise<void>;
  /** Schiri-Link ohne Anmeldung: meldet bei Bedarf anonym an, gibt die Schiri-Rolle und liefert die eigene ID. */
  joinWithRefereeLink?(tid: string, linkId: string): Promise<string>;
}

export const ROLE_LABEL: Record<RoleName, string> = {
  owner: 'Turnierleitung',
  results_helper: 'Helfer für Ergebnisse',
  extended_helper: 'Erweiterter Helfer',
  referee: 'Schiedsrichter',
};
