// Turnierbetrieb: Rückzug, Zeitverschiebung, Statuswechsel (§8.3, §9, §12 C/D/H).
import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTournament,
  markMatchNotPlayed,
  paths,
  recordResult,
  resetMatchToScheduled,
  restoreTeam,
  setMatchLive,
  setTournamentStatus,
  shiftFutureMatches,
  withdrawTeam,
} from '../../src/data';
import {
  EXTENDED,
  HELPER,
  OWNER,
  createEnv,
  currentRevision,
  dbFor,
  matchRevision,
  seedTournament,
  tournamentInput,
  type Seeded,
} from './setup';

let env: RulesTestEnvironment;
let s: Seeded;

beforeAll(async () => {
  env = await createEnv('demo-operations');
});

beforeEach(async () => {
  await env.clearFirestore();
  s = await seedTournament(env, 'full');
});

afterAll(async () => {
  await env.cleanup();
});

const owner = () => dbFor(env, OWNER);
const guest = () => dbFor(env, null);

describe('Nichtantritt und Rückzug', () => {
  it('vor dem ersten Spiel: „nicht erschienen“, geplante Spiele werden nicht ausgetragen', async () => {
    expect(await withdrawTeam(owner(), OWNER, s.tid, 't1')).toBe('no_show');
    const m = (await getDoc(paths.match(owner(), s.tid, s.matchF1))).data()!;
    expect(m).toMatchObject({ status: 'not_played', notPlayedReason: 'no_show' });
    expect(m.goalsA).toBeUndefined();
    const pubMatch = (await getDoc(paths.publicMatch(guest(), s.tid, s.matchF1))).data()!;
    expect(pubMatch.status).toBe('not_played');
    const pub = (await getDoc(paths.publicTournament(guest(), s.tid))).data()!;
    expect(pub.teams.find((t) => t.id === 't1')!.status).toBe('no_show');
  });

  it('nach Spielbeginn: „zurückgezogen“, beendete Spiele bleiben unverändert', async () => {
    await recordResult(owner(), OWNER, s.tid, s.matchF1, 2, 0, await matchRevision(env, s.tid, s.matchF1), { finish: true });
    expect(await withdrawTeam(owner(), OWNER, s.tid, 't1')).toBe('withdrawn');
    const m = (await getDoc(paths.match(owner(), s.tid, s.matchF1))).data()!;
    expect(m).toMatchObject({ status: 'completed', goalsA: 2, goalsB: 0 });
  });

  it('Rückzug lässt sich zurücknehmen und macht Vorschauen veraltet', async () => {
    const before = (await getDoc(paths.tournament(owner(), s.tid))).data()!.resultsRevision;
    await withdrawTeam(owner(), OWNER, s.tid, 't3');
    expect(await restoreTeam(owner(), OWNER, s.tid, 't3')).toBe('active');
    const t = (await getDoc(paths.tournament(owner(), s.tid))).data()!;
    expect(t.resultsRevision).toBe(before + 2);
  });

  it('Helfer dürfen keine Mannschaft zurückziehen', async () => {
    await expect(withdrawTeam(dbFor(env, EXTENDED), EXTENDED, s.tid, 't1')).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });
});

describe('Zeitverschiebung', () => {
  it('verschiebt nur noch nicht begonnene Spiele, live sichtbar für Gäste', async () => {
    await setMatchLive(owner(), OWNER, s.tid, s.matchF1, await matchRevision(env, s.tid, s.matchF1));
    expect(await shiftFutureMatches(owner(), OWNER, s.tid, 20)).toBe(1);
    const live = (await getDoc(paths.publicMatch(guest(), s.tid, s.matchF1))).data()!;
    const later = (await getDoc(paths.publicMatch(guest(), s.tid, s.matchF2))).data()!;
    expect(live.startISO).toBe('2026-11-07T09:00:00.000Z');
    expect(later.startISO).toBe('2026-11-07T09:20:00.000Z');
  });

  it('Helfer dürfen den Zeitplan nicht verschieben', async () => {
    await expect(shiftFutureMatches(dbFor(env, HELPER), HELPER, s.tid, 10)).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });
});

describe('Spielstatus', () => {
  it('versehentlich angepfiffen: zurück auf geplant, ohne Stand', async () => {
    const db = dbFor(env, HELPER);
    let m = await setMatchLive(db, HELPER, s.tid, s.matchF1, await matchRevision(env, s.tid, s.matchF1));
    m = await recordResult(db, HELPER, s.tid, s.matchF1, 1, 0, m.revision);
    m = await resetMatchToScheduled(db, HELPER, s.tid, s.matchF1, m.revision);
    expect(m.status).toBe('scheduled');
    expect(m.goalsA).toBeUndefined();
  });

  it('beendetes Spiel nachträglich „nicht ausgetragen“: nur Owner/erweiterte Helfer', async () => {
    const m = await recordResult(owner(), OWNER, s.tid, s.matchF1, 1, 0, await matchRevision(env, s.tid, s.matchF1), {
      finish: true,
    });
    await expect(
      markMatchNotPlayed(dbFor(env, HELPER), HELPER, s.tid, s.matchF1, 'other', m.revision),
    ).rejects.toMatchObject({ code: 'permission_denied' });
    const n = await markMatchNotPlayed(dbFor(env, EXTENDED), EXTENDED, s.tid, s.matchF1, 'other', m.revision);
    expect(n.status).toBe('not_played');
  });
});

describe('Turnierstatus', () => {
  it('beenden schließt alle freigegebenen Runden, auch öffentlich', async () => {
    await setTournamentStatus(owner(), OWNER, s.tid, await currentRevision(env, s.tid), 'finished');
    const round = (await getDoc(paths.publicRound(guest(), s.tid, s.roundId))).data()!;
    expect(round.status).toBe('closed');
    const pub = (await getDoc(paths.publicTournament(guest(), s.tid))).data()!;
    expect(pub.status).toBe('finished');
  });

  it('eine vorab vergebene Turnier-ID kann nicht doppelt angelegt werden', async () => {
    await createTournament(owner(), OWNER, tournamentInput('full'), { tournamentId: 'fest-1' });
    await expect(
      createTournament(dbFor(env, HELPER), HELPER, tournamentInput('full'), { tournamentId: 'fest-1' }),
    ).rejects.toMatchObject({ code: 'permission_denied' });
  });
});
