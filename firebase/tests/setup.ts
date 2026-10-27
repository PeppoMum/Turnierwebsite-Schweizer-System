// Gemeinsame Testumgebung für Regel- und Integrationstests gegen den Firestore-Emulator.
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Visibility } from '../../src/domain';
import {
  createTournament,
  paths,
  publishRound,
  saveRoundPreview,
  setVisibility,
  syncPublicTournament,
  type Actor,
  type NewTournamentInput,
} from '../../src/data';

export const OWNER: Actor = { uid: 'alice', email: 'alice@example.org' };
export const HELPER: Actor = { uid: 'hans', email: 'hans@example.org' }; // nur Feld f1
export const EXTENDED: Actor = { uid: 'erika', email: 'erika@example.org' }; // darf freigeben
export const OUTSIDER: Actor = { uid: 'otto', email: 'otto@example.org' };

export async function createEnv(projectId: string): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firebase/firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
}

export function dbFor(env: RulesTestEnvironment, actor: Actor | null): Firestore {
  if (!actor) return env.unauthenticatedContext().firestore() as unknown as Firestore;
  return env
    .authenticatedContext(actor.uid, {
      email: actor.email ?? undefined,
      firebase: { sign_in_provider: 'password' },
    })
    .firestore() as unknown as Firestore;
}

/** Anonymer Firebase-Login: hat eine uid, ist aber kein Konto zum Schreiben. */
export function anonymousDb(env: RulesTestEnvironment, uid = 'anon'): Firestore {
  return env
    .authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } })
    .firestore() as unknown as Firestore;
}

export const TEAM_IDS = ['t1', 't2', 't3', 't4', 't5'];
export const FIELD_IDS = ['f1', 'f2'];

export function tournamentInput(visibility: Visibility): NewTournamentInput {
  return {
    title: 'Herbstcup',
    organizerName: 'SV Musterstadt',
    venue: 'Sportpark',
    localDate: '2026-11-07',
    timeZone: 'Europe/Berlin',
    visibility,
    roundsTotal: 4,
    preDrawRounds: 1,
    pairingMode: 'balanced',
    points: { win: 3, draw: 1, loss: 0 },
    ranking: { primary: 'points_per_played_match', tieBreakers: ['head_to_head', 'goal_diff'] },
    schedule: {
      tournamentStartISO: '2026-11-07T09:00:00.000Z',
      matchMinutes: 12,
      turnoverMinutes: 3,
      roundBreakMinutes: 5,
      allocation: 'max_capacity',
    },
    fieldIds: FIELD_IDS,
  };
}

export interface Seeded {
  tid: string;
  roundId: string;
  /** Spiel auf Feld f1 (t1 gegen t2) und auf Feld f2 (t3 gegen t4). */
  matchF1: string;
  matchF2: string;
}

/**
 * Baut ein veröffentlichtes Turnier über die echten Owner-Abläufe auf (prüft damit auch
 * die Owner-Regeln): Turnier, Teams, Felder, Helfer-Grants, Runde 1 freigegeben.
 */
export async function seedTournament(
  env: RulesTestEnvironment,
  visibility: Visibility,
): Promise<Seeded> {
  const db = dbFor(env, OWNER);
  const tid = await createTournament(db, OWNER, tournamentInput('full'));

  const batch = writeBatch(db);
  TEAM_IDS.forEach((id, i) =>
    batch.set(doc(paths.teams(db, tid), id), {
      tournamentId: tid,
      name: `Team ${String.fromCharCode(69 - i)}`, // E, D, C, B, A – absichtlich nicht alphabetisch
      status: 'active',
      joinedAt: '2026-11-07T08:00:00.000Z',
    }),
  );
  FIELD_IDS.forEach((id, i) =>
    batch.set(doc(paths.fields(db, tid), id), {
      tournamentId: tid,
      name: `Platz ${i + 1}`,
      order: i,
      active: true,
    }),
  );
  batch.set(paths.roleGrant(db, tid, HELPER.uid), {
    uid: HELPER.uid,
    tournamentId: tid,
    role: 'results_helper',
    allowedFieldIds: ['f1'],
    createdAt: serverTimestamp(),
    createdBy: OWNER.uid,
  } as never);
  batch.set(paths.roleGrant(db, tid, EXTENDED.uid), {
    uid: EXTENDED.uid,
    tournamentId: tid,
    role: 'extended_helper',
    canPublishRounds: true,
    createdAt: serverTimestamp(),
    createdBy: OWNER.uid,
  } as never);
  await batch.commit();

  await syncPublicTournament(db, tid, { isPublic: true });
  const { roundId, matchIds } = await saveRoundPreview(db, OWNER, tid, {
    number: 1,
    mode: 'draw',
    plannedStartISO: '2026-11-07T09:00:00.000Z',
    generatedFromRevision: 0,
    matches: [
      { teamAId: 't1', teamBId: 't2', fieldId: 'f1', waveIndex: 0, startISO: '2026-11-07T09:00:00.000Z', durationMinutes: 12 },
      { teamAId: 't3', teamBId: 't4', fieldId: 'f2', waveIndex: 0, startISO: '2026-11-07T09:00:00.000Z', durationMinutes: 12 },
    ],
    byeTeamIds: ['t5'],
  });
  await publishRound(db, OWNER, tid, roundId);
  if (visibility !== 'full') {
    const rev = await currentRevision(env, tid);
    await setVisibility(db, OWNER, tid, rev, visibility);
  }
  return { tid, roundId, matchF1: matchIds[0]!, matchF2: matchIds[1]! };
}

export async function currentRevision(env: RulesTestEnvironment, tid: string): Promise<number> {
  let rev = -1;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore() as unknown as Firestore, `tournaments/${tid}`));
    rev = (snap.data() as { revision: number }).revision;
  });
  return rev;
}

export async function matchRevision(
  env: RulesTestEnvironment,
  tid: string,
  matchId: string,
): Promise<number> {
  let rev = -1;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore() as unknown as Firestore, `tournaments/${tid}/matches/${matchId}`));
    rev = (snap.data() as { revision: number }).revision;
  });
  return rev;
}

/** Schreibt ein Dokument an den Regeln vorbei (z. B. „vergessene“ Altdaten). */
export async function forceSet(
  env: RulesTestEnvironment,
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, path), data);
  });
}
