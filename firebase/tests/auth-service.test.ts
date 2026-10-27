// Anmeldung und Helfer-Einladung über die echten Firebase-SDKs gegen Auth- und Firestore-Emulator.
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { firebaseActorSource } from '../../src/data';
import { FirebaseAuthService } from '../../src/ui/data/firebaseAuth';
import { FirestoreTournamentStore } from '../../src/ui/data/firestoreStore';

const apps: FirebaseApp[] = [];
const stores: FirestoreTournamentStore[] = [];

function client(name: string) {
  const app = initializeApp({ projectId: 'demo-turnier', apiKey: 'demo-api-key' }, `${name}-${Date.now()}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const store = new FirestoreTournamentStore(db, firebaseActorSource(auth));
  stores.push(store);
  return { auth: new FirebaseAuthService(auth, db, () => 'https://peppomum.github.io/turnier/'), store };
}

afterAll(async () => {
  stores.forEach((s) => s.dispose());
  await Promise.all(apps.map((a) => deleteApp(a)));
});

const stamp = Date.now();

describe('FirebaseAuthService', () => {
  it('Turnierleitung lädt ein, Helfer meldet sich an und löst genau einmal ein', async () => {
    const owner = client('owner');
    await owner.auth.registerWithEmail(`leitung-${stamp}@example.org`, 'geheim123');
    expect(owner.auth.isReady()).toBe(true);
    expect(owner.auth.current()?.email).toBe(`leitung-${stamp}@example.org`);
    // Stabile Referenz für useSyncExternalStore.
    expect(owner.auth.current()).toBe(owner.auth.current());

    const tid = await owner.store.createTournament(
      {
        id: `auth-${stamp}`,
        title: 'Einladungs-Cup',
        organizerName: 'SV Test',
        venue: '',
        localDate: '2026-11-07',
        timeZone: 'Europe/Berlin',
        sponsors: [],
        teams: ['A', 'B', 'C', 'D'].map((name, i) => ({ id: `t${i}`, name, active: true })),
        roundsTotal: 3,
        preDrawRounds: 1,
        pairingMode: 'balanced',
        tieBreakers: ['head_to_head', 'goal_diff', 'goals_for'],
        buchholzEnabled: false,
        fields: [{ id: 'a', name: 'Platz 1' }],
        startTime: '10:00',
        matchMinutes: 12,
        turnoverMinutes: 3,
        roundBreakMinutes: 5,
        restOptimization: false,
        hardRestMinutes: null,
        allocation: 'max_capacity',
        visibility: 'full',
      },
      false,
    );
    const link = await owner.auth.createInvitation(tid, { role: 'results_helper', validForHours: 24 });
    expect(link).toMatch(new RegExp(`^https://peppomum\\.github\\.io/turnier/#/einladung/${tid}/[A-Za-z0-9]{20}$`));
    const inviteId = link.split('/').pop()!;

    const helper = client('helper');
    await helper.auth.registerWithEmail(`helfer-${stamp}@example.org`, 'geheim123');
    expect(await helper.auth.getInvitation(tid, inviteId)).toEqual({
      tournamentTitle: 'Einladungs-Cup',
      role: 'results_helper',
      problem: null,
    });
    expect(await helper.auth.redeemInvitation(tid, inviteId)).toBe('results_helper');
    const after = await helper.auth.getInvitation(tid, inviteId);
    expect(after.problem).toMatch(/bereits verwendet/);

    const other = client('other');
    await other.auth.registerWithEmail(`dritter-${stamp}@example.org`, 'geheim123');
    await expect(other.auth.redeemInvitation(tid, inviteId)).rejects.toMatchObject({ code: 'invitation_unusable' });

    await helper.auth.signOut();
    expect(helper.auth.current()).toBeNull();
  });

  it('falsches Passwort gibt eine verständliche Meldung', async () => {
    const c = client('wrong');
    await c.auth.registerWithEmail(`falsch-${stamp}@example.org`, 'richtig123');
    await c.auth.signOut();
    await expect(c.auth.signInWithEmail(`falsch-${stamp}@example.org`, 'falsch')).rejects.toThrow(
      'E-Mail oder Passwort stimmen nicht.',
    );
  });
});
