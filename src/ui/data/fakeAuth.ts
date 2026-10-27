// Einfacher Auth-Ersatz für Tests und Vorschau der Anmeldeseiten.
import type { RoleName } from '../../domain';
import type { AuthService, AuthUser, InvitationInfo } from './auth';

export class FakeAuth implements AuthService {
  private user: AuthUser | null;
  private listeners = new Set<() => void>();
  redeemed: string[] = [];

  constructor(
    user: AuthUser | null = null,
    private invitation: InvitationInfo = { tournamentTitle: 'Herbstcup 2026', role: 'results_helper', problem: null },
  ) {
    this.user = user;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  isReady() {
    return true;
  }
  current() {
    return this.user;
  }
  private set(user: AuthUser | null) {
    this.user = user;
    this.listeners.forEach((l) => l());
  }
  async signInWithEmail(email: string, password: string) {
    if (password !== 'geheim') throw new Error('E-Mail oder Passwort stimmen nicht.');
    this.set({ uid: 'u1', email });
  }
  async registerWithEmail(email: string) {
    this.set({ uid: 'u1', email });
  }
  async signInWithGoogle() {
    this.set({ uid: 'g1', email: 'google@example.com' });
  }
  async sendPasswordReset() {}
  async signOut() {
    this.set(null);
  }
  async getInvitation() {
    return this.invitation;
  }
  async redeemInvitation(tid: string, inviteId: string): Promise<RoleName> {
    this.redeemed.push(`${tid}/${inviteId}`);
    return this.invitation.role;
  }
  async createInvitation(tid: string) {
    return `https://example.com/#/einladung/${tid}/neu1`;
  }
}
