// Firebase-Umsetzung von AuthService: Anmeldung über src/data/auth.ts, Einladungen über
// src/data/invitations.ts. Anonyme Logins zählen nicht als angemeldet.
import { onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { RoleName } from '../../domain';
import {
  buildInvitationLink,
  createHelperInvitation,
  getInvitation,
  invitationProblem,
  redeemInvitation,
  registerWithEmail,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOut,
} from '../../data';
import type { AuthService, AuthUser, CreateInvitationInput, InvitationInfo } from './auth';

/** Basisadresse der App (ohne Hash), für Einladungslinks. */
function appBaseUrl(): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}`;
}

export class FirebaseAuthService implements AuthService {
  private listeners = new Set<() => void>();
  private ready = false;
  private user: AuthUser | null = null;

  constructor(
    private auth: Auth,
    private db: Firestore,
    private baseUrl: () => string = appBaseUrl,
  ) {
    onAuthStateChanged(auth, (u) => this.update(u));
  }

  private update(u: User | null): void {
    const next = u && !u.isAnonymous ? { uid: u.uid, email: u.email } : null;
    // Gleiche Person: Referenz behalten (useSyncExternalStore braucht stabile Werte).
    const same = next?.uid === this.user?.uid && next?.email === this.user?.email;
    if (!same) this.user = next;
    const changed = !same || !this.ready;
    this.ready = true;
    if (changed) this.listeners.forEach((l) => l());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  isReady = (): boolean => this.ready;

  current = (): AuthUser | null => this.user;

  private actor() {
    if (!this.user) throw new Error('Bitte melde dich zuerst an.');
    return this.user;
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    await signInWithEmail(this.auth, email, password);
  }

  async registerWithEmail(email: string, password: string): Promise<void> {
    await registerWithEmail(this.auth, email, password);
  }

  async signInWithGoogle(): Promise<void> {
    await signInWithGoogle(this.auth);
  }

  async sendPasswordReset(email: string): Promise<void> {
    await sendPasswordReset(this.auth, email);
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
  }

  async getInvitation(tid: string, inviteId: string): Promise<InvitationInfo> {
    const inv = await getInvitation(this.db, tid, inviteId);
    return { tournamentTitle: inv.tournamentTitle, role: inv.role, problem: invitationProblem(inv) };
  }

  redeemInvitation(tid: string, inviteId: string): Promise<RoleName> {
    return redeemInvitation(this.db, this.actor(), tid, inviteId);
  }

  async createInvitation(tid: string, input: CreateInvitationInput): Promise<string> {
    const inviteId = await createHelperInvitation(this.db, this.actor(), tid, {
      role: input.role,
      validForHours: input.validForHours,
      canPublishRounds: input.canPublishRounds,
    });
    return buildInvitationLink(this.baseUrl(), tid, inviteId);
  }
}
