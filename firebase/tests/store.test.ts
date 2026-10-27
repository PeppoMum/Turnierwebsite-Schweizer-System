// Firestore-Implementierung der UI-Schnittstelle TournamentService gegen den Emulator:
// Turnier anlegen, live eintragen, Gastansicht je Sichtbarkeitsmodus, nächste Runde.
import { type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor, ActorSource } from '../../src/data';
import { FirestoreTournamentStore } from '../../src/ui/data/firestoreStore';
import type { WizardDraft } from '../../src/ui/data/types';
import { OWNER, createEnv, dbFor } from './setup';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const fixed = (actor: Actor | null): ActorSource => ({ current: () => actor, onChange: () => () => undefined });

async function waitFor<T>(fn: () => T | undefined | false, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('Zeitüberschreitung beim Warten auf Daten');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const draft: WizardDraft = {
  id: 'store-cup',
  title: 'Store-Cup',
  organizerName: 'SV Test',
  venue: 'Platzanlage',
  localDate: '2026-11-07',
  timeZone: 'Europe/Berlin',
  organizerLogo: PNG_1PX,
  sponsors: [{ id: 's', name: 'Bäckerei', url: 'https://example.org', logo: PNG_1PX }],
  teams: ['Adler', 'Bären', 'Dachse', 'Elche', 'Füchse'].map((name, i) => ({ id: `x${i}`, name, active: true })),
  roundsTotal: 3,
  preDrawRounds: 1,
  pairingMode: 'balanced',
  tieBreakers: ['head_to_head', 'goal_diff', 'goals_for'],
  buchholzEnabled: false,
  fields: [{ id: 'a', name: 'Platz 1' }, { id: 'b', name: 'Platz 2' }],
  startTime: '10:00',
  matchMinutes: 12,
  turnoverMinutes: 3,
  roundBreakMinutes: 5,
  restOptimization: false,
  hardRestMinutes: null,
  allocation: 'max_capacity',
  visibility: 'kids',
};

let env: RulesTestEnvironment;
let owner: FirestoreTournamentStore;
let guest: FirestoreTournamentStore;

beforeAll(async () => {
  env = await createEnv('demo-store');
  await env.clearFirestore();
  owner = new FirestoreTournamentStore(dbFor(env, OWNER), fixed(OWNER));
  guest = new FirestoreTournamentStore(dbFor(env, null), fixed(null));
});

afterAll(async () => {
  owner.dispose();
  guest.dispose();
  await env.cleanup();
});

describe('FirestoreTournamentStore', () => {
  let tid: string;

  it('legt ein Turnier mit Logos an und gibt Runde 1 frei', async () => {
    tid = await owner.createTournament(draft, true);
    expect(tid).toBe('store-cup');
    const data = await waitFor(() => {
      const d = owner.get(tid);
      return d && d.tournament.currentRound === 1 && d.rounds[0]?.status === 'published' ? d : undefined;
    });
    expect(data.tournament.status).toBe('published');
    expect(data.rounds[0]!.status).toBe('published');
    expect(data.byes).toHaveLength(1);
    expect(data.matches.every((m) => m.fieldId && m.startISO)).toBe(true);
    expect(data.tournament.schedule.tournamentStartISO).toBe('2026-11-07T09:00:00.000Z');
    expect(Object.keys(data.assets)).toHaveLength(2);
    expect(owner.getAll().map((d) => d.tournament.id)).toContain(tid);
  });

  it('Gast sieht im Kindermodus Paarungen und Logos, aber keine Tore und keine Tabelle', async () => {
    const d = owner.get(tid)!;
    const m = d.matches[0]!;
    await owner.recordScore(tid, m.id, 3, 1);
    await waitFor(() => owner.get(tid)?.matches.find((x) => x.id === m.id)?.goalsA === 3);
    const view = await waitFor(() => {
      const v = guest.getPublic(tid);
      return v && v.matches.find((x) => x.id === m.id)?.status === 'live' ? v : undefined;
    });
    expect(view.organizerLogo).toBe(PNG_1PX);
    expect(view.sponsors[0]!.logo).toBe(PNG_1PX);
    expect(view.matches.every((x) => x.goalsA === undefined)).toBe(true);
    expect(view.standings).toBeUndefined();
    expect(view.byes).toHaveLength(1);
    expect(guest.get(tid)).toBeUndefined();
  });

  it('nach Umschalten auf „vollständig“ sieht der Gast Tore und Tabelle', async () => {
    const m = owner.get(tid)!.matches[0]!;
    await owner.setMatchStatus(tid, m.id, 'completed');
    await waitFor(() => {
      const d = owner.get(tid);
      return d?.tournament.status === 'running' && d.matches.find((x) => x.id === m.id)?.status === 'completed';
    });
    await owner.setVisibility(tid, 'full');
    const view = await waitFor(() => {
      const v = guest.getPublic(tid);
      return v?.standings && v.matches.find((x) => x.id === m.id)?.goalsA === 3 ? v : undefined;
    });
    expect(view.matches.find((x) => x.id === m.id)!.goalsB).toBe(1);
    expect(view.standings!.find((r) => r.teamId === m.teamAId)!.points).toBe(3);
  });

  it('Runde schließen und die nächste Runde freigeben', async () => {
    const second = owner.get(tid)!.matches.find((x) => x.status === 'scheduled')!;
    await owner.markNotPlayed(tid, second.id, 'no_show');
    await waitFor(() => owner.get(tid)?.matches.find((x) => x.id === second.id)?.status === 'not_played');
    await owner.closeCurrentRound(tid);
    await waitFor(() => owner.get(tid)?.rounds[0]?.status === 'closed');
    await waitFor(() => owner.get(tid)?.tournament.visibility === 'full');
    const preview = owner.previewNextRound(tid, 7);
    expect(preview.roundNumber).toBe(2);
    await owner.publishRound(tid, preview, '2026-11-07T09:40:00.000Z');
    const view = await waitFor(() => {
      const v = guest.getPublic(tid);
      return v && v.rounds.length === 2 ? v : undefined;
    });
    expect(view.matches.filter((x) => x.roundNumber === 2)).toHaveLength(2);
    await waitFor(() => owner.get(tid)?.tournament.currentRound === 2);
  });

  it('Zeitverschiebung, Rückzug und Turnierende', async () => {
    expect(await owner.shiftFutureMatches(tid, 10)).toBe(2);
    const teamId = owner.get(tid)!.teams[0]!.id;
    await owner.withdrawTeam(tid, teamId);
    await waitFor(() => owner.get(tid)?.teams.find((t) => t.id === teamId)?.status === 'withdrawn');
    await waitFor(() => owner.get(tid)?.matches.every((x) => x.status !== 'scheduled' || x.revision >= 2));
    await owner.finishTournament(tid);
    const view = await waitFor(() => {
      const v = guest.getPublic(tid);
      return v?.tournament.status === 'finished' ? v : undefined;
    });
    expect(view.teams.find((t) => t.id === teamId)!.status).toBe('withdrawn');
  });

  it('unbekanntes oder nicht öffentliches Turnier: Laden endet ohne Ansicht', async () => {
    expect(guest.getPublic('gibt-es-nicht')).toBeUndefined();
    await waitFor(() => guest.isLoading('gibt-es-nicht') === false);
    expect(guest.getPublic('gibt-es-nicht')).toBeUndefined();
  });

  it('ohne Anmeldung kann nichts gespeichert werden', async () => {
    await expect(guest.setVisibility(tid, 'kids')).rejects.toMatchObject({ code: 'not_found' });
    await expect(guest.createTournament({ ...draft, id: 'x' }, false)).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });
});
