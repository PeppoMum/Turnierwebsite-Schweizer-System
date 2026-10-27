// Gäste (ohne Konto) und Sichtbarkeitsmodi: Spezifikation §3, §4.4, §12 B.
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paths, recordResult } from '../../src/data';
import { anonymousDb, createEnv, dbFor, forceSet, HELPER, matchRevision, OWNER, seedTournament, type Seeded } from './setup';

let env: RulesTestEnvironment;
let full: Seeded;
let noStandings: Seeded;
let kids: Seeded;

beforeAll(async () => {
  env = await createEnv('demo-guest');
  await env.clearFirestore();
  full = await seedTournament(env, 'full');
  noStandings = await seedTournament(env, 'no_standings');
  kids = await seedTournament(env, 'kids');
  // In allen drei Turnieren ein Ergebnis eintragen (Helfer, Feld f1).
  for (const s of [full, noStandings, kids]) {
    const db = dbFor(env, HELPER);
    const rev = await matchRevision(env, s.tid, s.matchF1);
    await recordResult(db, HELPER, s.tid, s.matchF1, 2, 1, rev, {
      finish: true,
      standingsAfter: () => ({ rows: [], throughRound: 1 }),
    });
  }
});

afterAll(async () => {
  await env.cleanup();
});

describe('Gast: private Daten', () => {
  it('kann keine privaten Turnierdaten lesen', async () => {
    const db = dbFor(env, null);
    await assertFails(getDoc(paths.tournament(db, kids.tid)));
    await assertFails(getDocs(paths.matches(db, kids.tid)));
    await assertFails(getDoc(paths.match(db, kids.tid, kids.matchF1)));
    await assertFails(getDocs(paths.teams(db, kids.tid)));
    await assertFails(getDocs(paths.rounds(db, kids.tid)));
    await assertFails(getDocs(paths.audit(db, kids.tid)));
    await assertFails(getDocs(paths.roleGrants(db, kids.tid)));
    await assertFails(getDocs(paths.assets(db, kids.tid)));
  });

  it('ein Konto ohne Rolle kann ebenfalls keine privaten Daten lesen', async () => {
    const db = dbFor(env, { uid: 'otto', email: 'otto@example.org' });
    await assertFails(getDoc(paths.tournament(db, full.tid)));
    await assertFails(getDocs(paths.matches(db, full.tid)));
  });

  it('kann nirgends schreiben, auch nicht mit anonymem Login', async () => {
    for (const db of [dbFor(env, null), anonymousDb(env)]) {
      await assertFails(setDoc(doc(db, 'tournaments/neu'), { title: 'x' }));
      await assertFails(updateDoc(paths.publicTournament(db, full.tid), { title: 'gehackt' }));
      await assertFails(setDoc(paths.publicResult(db, full.tid, full.matchF1), { goalsA: 9 } as never));
      await assertFails(setDoc(doc(db, `publicTournaments/${full.tid}/publicMatches/x`), { status: 'live' }));
      await assertFails(setDoc(doc(db, 'irgendwas/x'), { a: 1 }));
    }
  });
});

describe('Gast: Sichtbarkeitsmodus „vollständig“', () => {
  it('sieht Turnier, Runden, Spiele, Ergebnisse und Tabelle', async () => {
    const db = dbFor(env, null);
    await assertSucceeds(getDoc(paths.publicTournament(db, full.tid)));
    await assertSucceeds(getDocs(paths.publicRounds(db, full.tid)));
    await assertSucceeds(getDocs(paths.publicMatches(db, full.tid)));
    const results = await assertSucceeds(getDocs(paths.publicResults(db, full.tid)));
    const r = results.docs.find((d) => d.id === full.matchF1)!.data();
    expect([r.goalsA, r.goalsB, r.status]).toEqual([2, 1, 'completed']);
    await assertSucceeds(getDoc(paths.publicStandings(db, full.tid)));
  });
});

describe('Gast: Sichtbarkeitsmodus „ohne Tabelle“', () => {
  it('sieht Ergebnisse, aber keine Tabelle', async () => {
    const db = dbFor(env, null);
    await assertSucceeds(getDocs(paths.publicResults(db, noStandings.tid)));
    await assertFails(getDoc(paths.publicStandings(db, noStandings.tid)));
  });
});

describe('Gast: Kinderfußballmodus', () => {
  it('sieht Plan, Paarungen, Felder und Zeiten', async () => {
    const db = dbFor(env, null);
    const t = await assertSucceeds(getDoc(paths.publicTournament(db, kids.tid)));
    expect(t.data()!.visibility).toBe('kids');
    const matches = await assertSucceeds(getDocs(paths.publicMatches(db, kids.tid)));
    expect(matches.size).toBe(2);
    await assertSucceeds(getDocs(paths.publicRounds(db, kids.tid)));
  });

  it('bekommt keine Tore: weder im Spiel-Dokument noch über Ergebnis- oder Tabellenabfragen', async () => {
    const db = dbFor(env, null);
    const matches = await getDocs(paths.publicMatches(db, kids.tid));
    for (const m of matches.docs) {
      const keys = Object.keys(m.data());
      expect(keys).not.toContain('goalsA');
      expect(keys).not.toContain('goalsB');
    }
    await assertFails(getDocs(paths.publicResults(db, kids.tid)));
    await assertFails(getDoc(paths.publicResult(db, kids.tid, kids.matchF1)));
    await assertFails(getDoc(paths.publicStandings(db, kids.tid)));
  });

  it('es existieren keine Ergebnis- oder Tabellendokumente', async () => {
    let count = -1;
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const results = await getDocs(collection(db as never, `publicTournaments/${kids.tid}/publicResults`));
      const standings = await getDocs(collection(db as never, `publicTournaments/${kids.tid}/publicStandings`));
      count = results.size + standings.size;
    });
    expect(count).toBe(0);
  });

  it('auch zurückgebliebene Altdaten sind für Gäste nicht lesbar', async () => {
    await forceSet(env, `publicTournaments/${kids.tid}/publicResults/alt`, { matchId: 'alt', goalsA: 5, goalsB: 0 });
    await forceSet(env, `publicTournaments/${kids.tid}/publicStandings/current`, { rows: [] });
    const db = dbFor(env, null);
    await assertFails(getDoc(paths.publicResult(db, kids.tid, 'alt')));
    await assertFails(getDoc(paths.publicStandings(db, kids.tid)));
  });

  it('die Teamliste ist alphabetisch und nicht nach Tabelle sortiert', async () => {
    const db = dbFor(env, null);
    const t = (await getDoc(paths.publicTournament(db, kids.tid))).data()!;
    const names = t.teams.map((x) => x.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')));
  });

  it('der Admin sieht intern trotzdem alle Ergebnisse', async () => {
    const db = dbFor(env, OWNER);
    const m = (await assertSucceeds(getDoc(paths.match(db, kids.tid, kids.matchF1)))).data()!;
    expect([m.goalsA, m.goalsB]).toEqual([2, 1]);
  });
});

describe('Gast: nicht veröffentlichtes Turnier', () => {
  it('ist nach dem Offline-Nehmen nicht mehr lesbar', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore() as never, `publicTournaments/${noStandings.tid}`), { isPublic: false });
    });
    const db = dbFor(env, null);
    await assertFails(getDoc(paths.publicTournament(db, noStandings.tid)));
    await assertFails(getDocs(paths.publicMatches(db, noStandings.tid)));
    await assertFails(getDocs(paths.publicResults(db, noStandings.tid)));
  });
});
