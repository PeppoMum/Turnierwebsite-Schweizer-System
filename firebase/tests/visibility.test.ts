// Umschalten des Sichtbarkeitsmodus während des Turniers (§2.1, §12 B).
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { paths, recordResult, setVisibility, type PublicStandingRow } from '../../src/data';
import { HELPER, OWNER, createEnv, currentRevision, dbFor, matchRevision, seedTournament, type Seeded } from './setup';

let env: RulesTestEnvironment;
let s: Seeded;

const row: PublicStandingRow = {
  rank: 1, teamId: 't1', played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 1,
  goalDiff: 1, points: 3, quotient: 3, byes: 0, buchholz: null, eligible: true,
};

beforeAll(async () => {
  env = await createEnv('demo-visibility');
});

beforeEach(async () => {
  await env.clearFirestore();
  s = await seedTournament(env, 'full');
  await recordResult(dbFor(env, HELPER), HELPER, s.tid, s.matchF1, 2, 1, await matchRevision(env, s.tid, s.matchF1), {
    finish: true,
    standingsAfter: () => ({ rows: [row], throughRound: 1 }),
  });
});

afterAll(async () => {
  await env.cleanup();
});

async function rawCounts() {
  let counts = { results: -1, standings: -1 };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as never;
    counts = {
      results: (await getDocs(collection(db, `publicTournaments/${s.tid}/publicResults`))).size,
      standings: (await getDocs(collection(db, `publicTournaments/${s.tid}/publicStandings`))).size,
    };
  });
  return counts;
}

describe('Sichtbarkeit umschalten', () => {
  it('vollständig -> Kinder löscht Ergebnisse und Tabelle und sperrt sie für Gäste', async () => {
    expect(await rawCounts()).toEqual({ results: 1, standings: 1 });
    await setVisibility(dbFor(env, OWNER), OWNER, s.tid, await currentRevision(env, s.tid), 'kids');
    expect(await rawCounts()).toEqual({ results: 0, standings: 0 });
    const guest = dbFor(env, null);
    await assertFails(getDocs(paths.publicResults(guest, s.tid)));
    await assertFails(getDoc(paths.publicStandings(guest, s.tid)));
  });

  it('im Kindermodus entstehen durch Ergebniseingaben keine öffentlichen Tore', async () => {
    await setVisibility(dbFor(env, OWNER), OWNER, s.tid, await currentRevision(env, s.tid), 'kids');
    await recordResult(dbFor(env, OWNER), OWNER, s.tid, s.matchF2, 4, 0, await matchRevision(env, s.tid, s.matchF2), {
      finish: true,
      standingsAfter: () => ({ rows: [row], throughRound: 1 }),
    });
    expect(await rawCounts()).toEqual({ results: 0, standings: 0 });
    const pub = (await getDoc(paths.publicMatch(dbFor(env, null), s.tid, s.matchF2))).data()!;
    expect(pub.status).toBe('completed');
    expect(Object.keys(pub)).not.toContain('goalsA');
  });

  it('im Kindermodus lehnen die Regeln Ergebnis- und Tabellendokumente ab, auch vom Owner', async () => {
    await setVisibility(dbFor(env, OWNER), OWNER, s.tid, await currentRevision(env, s.tid), 'kids');
    const db = dbFor(env, OWNER);
    await assertFails(
      setDoc(paths.publicResult(db, s.tid, s.matchF1), {
        matchId: s.matchF1, roundId: s.roundId, status: 'completed', goalsA: 2, goalsB: 1, sourceRevision: 9,
        updatedAt: serverTimestamp(),
      } as never),
    );
    await assertFails(
      setDoc(paths.publicStandings(db, s.tid), { rows: [], throughRound: 1, resultsRevision: 1, updatedAt: serverTimestamp() } as never),
    );
  });

  it('Kinder -> vollständig veröffentlicht die Ergebnisse wieder', async () => {
    const owner = dbFor(env, OWNER);
    await setVisibility(owner, OWNER, s.tid, await currentRevision(env, s.tid), 'kids');
    await setVisibility(owner, OWNER, s.tid, await currentRevision(env, s.tid), 'full', {
      standings: { rows: [row], throughRound: 1 },
    });
    const guest = dbFor(env, null);
    const r = (await assertSucceeds(getDoc(paths.publicResult(guest, s.tid, s.matchF1)))).data()!;
    expect([r.goalsA, r.goalsB]).toEqual([2, 1]);
    const st = (await assertSucceeds(getDoc(paths.publicStandings(guest, s.tid)))).data()!;
    expect(st.rows[0]!.teamId).toBe('t1');
  });

  it('ohne Tabelle: Ergebnisse bleiben, Tabelle verschwindet', async () => {
    await setVisibility(dbFor(env, OWNER), OWNER, s.tid, await currentRevision(env, s.tid), 'no_standings');
    expect(await rawCounts()).toEqual({ results: 2, standings: 0 });
  });

  it('öffentliche und private Sichtbarkeit können nicht auseinanderlaufen', async () => {
    const db = dbFor(env, OWNER);
    await setVisibility(db, OWNER, s.tid, await currentRevision(env, s.tid), 'kids');
    const pub = (await getDoc(paths.publicTournament(db, s.tid))).data()!;
    await assertFails(
      setDoc(paths.publicTournament(db, s.tid), { ...pub, visibility: 'full', updatedAt: serverTimestamp() } as never),
    );
  });
});
