import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { MatchDoc, TournamentDoc } from './model';
import {
  resultsArePublic,
  standingsArePublic,
  toPublicMatch,
  toPublicResult,
  toPublicTournament,
} from './projections';

const now = Timestamp.fromMillis(0);

const match: MatchDoc = {
  roundId: 'round-01',
  roundNumber: 1,
  teamAId: 'a',
  teamBId: 'b',
  fieldId: 'f1',
  durationMinutes: 12,
  status: 'completed',
  goalsA: 3,
  goalsB: 1,
  revision: 4,
  createdAt: now,
  updatedAt: now,
};

describe('Sichtbarkeitsmodi', () => {
  it('Kindermodus: keine Ergebnisse, keine Tabelle', () => {
    expect(resultsArePublic('kids')).toBe(false);
    expect(standingsArePublic('kids')).toBe(false);
    expect(resultsArePublic('no_standings')).toBe(true);
    expect(standingsArePublic('no_standings')).toBe(false);
    expect(standingsArePublic('full')).toBe(true);
  });
});

describe('toPublicMatch', () => {
  it('enthält nie Tore', () => {
    const pub = toPublicMatch('m1', match);
    expect(Object.keys(pub)).not.toEqual(expect.arrayContaining(['goalsA']));
    expect(JSON.stringify(pub)).not.toMatch(/goals/);
    expect(pub).toMatchObject({ teamAId: 'a', teamBId: 'b', status: 'completed', sourceRevision: 4 });
  });

  it('verweigert Entwürfe', () => {
    expect(() => toPublicMatch('m1', { ...match, status: 'draft' })).toThrow();
  });
});

describe('toPublicResult', () => {
  it('übernimmt den Stand, fehlende Tore als null', () => {
    expect(toPublicResult('m1', match)).toMatchObject({ goalsA: 3, goalsB: 1 });
    const { goalsA: _a, goalsB: _b, ...noGoals } = match;
    void _a;
    void _b;
    expect(toPublicResult('m1', { ...noGoals, status: 'scheduled' })).toMatchObject({ goalsA: null, goalsB: null });
  });
});

describe('toPublicTournament', () => {
  const t = {
    ownerUid: 'o',
    title: 'Cup',
    organizerName: 'SV',
    localDate: '2026-11-07',
    timeZone: 'Europe/Berlin',
    status: 'running',
    visibility: 'kids',
    roundsTotal: 4,
    preDrawRounds: 1,
    pairingMode: 'balanced',
    points: { win: 3, draw: 1, loss: 0 },
    ranking: { primary: 'points_per_played_match', tieBreakers: [] },
    schedule: { tournamentStartISO: '', matchMinutes: 12, turnoverMinutes: 3, roundBreakMinutes: 0, allocation: 'max_capacity' },
    fieldIds: [],
    currentRound: 1,
    revision: 7,
    resultsRevision: 3,
    createdAt: now,
    updatedAt: now,
  } as TournamentDoc;

  it('sortiert Teams alphabetisch, lässt inaktive weg und kopiert keine internen Felder', () => {
    const pub = toPublicTournament('t', t, {
      teams: [
        { id: '1', tournamentId: 't', name: 'Zebras', status: 'active', joinedAt: '', seed: 1 },
        { id: '2', tournamentId: 't', name: 'Adler', status: 'withdrawn', joinedAt: '', externalNote: 'intern' },
        { id: '3', tournamentId: 't', name: 'Möwen', status: 'inactive', joinedAt: '' },
      ],
      fields: [
        { id: 'f2', tournamentId: 't', name: 'B', order: 1, active: true },
        { id: 'f1', tournamentId: 't', name: 'A', order: 0, active: true },
      ],
      sponsors: [],
      isPublic: true,
    });
    expect(pub.teams.map((x) => x.name)).toEqual(['Adler', 'Zebras']);
    expect(pub.fields.map((f) => f.id)).toEqual(['f1', 'f2']);
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/ownerUid|externalNote|seed|resultsRevision|pairingMode/);
  });
});
