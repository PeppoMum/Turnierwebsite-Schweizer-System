import { createFixtures } from '../../../data/fixtures';
import { MockTournamentStore } from '../../../data/mockStore';
import { buildStageModel, matchTitle, resultText, sideText } from './model';

const TID = 'sommercup';

function store() {
  return new MockTournamentStore(createFixtures(), false);
}

const name = (s: MockTournamentStore) => (id: string) => s.get(TID)!.teams.find((t) => t.id === id)?.name ?? id;

describe('Turnierleitung: Modell aus den Daten', () => {
  it('benennt Platzhalter und Spiele in Alltagssprache', () => {
    const s = store();
    const d = s.get(TID)!;
    const f = d.tournament.format!;
    const sf1 = d.matches.find((m) => m.matchKey === 'SF1')!;
    const final = d.matches.find((m) => m.matchKey === 'F')!;
    expect(matchTitle(sf1, f)).toBe('Endrunde · Halbfinale 1');
    expect(sideText(sf1, 'A', f, name(s))).toBe('1. Gruppe A');
    expect(sideText(final, 'B', f, name(s))).toBe('Sieger Halbfinale 2');
    expect(matchTitle(d.matches[0]!, f)).toBe('Vorrunde · Gruppe A');
  });

  it('schlägt die Gruppe A für die Endrunde vor, solange Gruppe B noch läuft', () => {
    const s = store();
    const model = buildStageModel(s.get(TID)!)!;
    const groupA = model.standings.vorrunde!.groups[0]!;
    const proposed = model.resolution.changes.map((c) => c.toTeamId);
    expect(model.standings.vorrunde!.groupComplete).toEqual([true, false]);
    expect(proposed).toContain(groupA[0]!.teamId);
    expect(proposed).toContain(groupA[1]!.teamId);
    expect(proposed).not.toContain(model.standings.vorrunde!.groups[1]![0]!.teamId);
  });

  it('nach dem letzten Gruppenspiel stehen alle Endrunden-Plätze zum Eintragen bereit', async () => {
    const s = store();
    const live = s.get(TID)!.matches.find((m) => m.status === 'live')!;
    await s.setMatchStatus(TID, live.id, 'completed');
    const model = buildStageModel(s.get(TID)!)!;
    // Halbfinale (4 Seiten) und Platzierungsspiele P5, P7 (4 Seiten), sofern kein Los fehlt.
    if (model.openLots.length === 0) expect(model.resolution.changes).toHaveLength(8);
    await s.confirmSlotFills(TID, model.resolution.changes.map((c) => ({ matchId: c.matchId, side: c.side, teamId: c.toTeamId })));
    expect(buildStageModel(s.get(TID)!)!.resolution.changes).toHaveLength(0);
  });

  it('zeigt Endrunden-Ergebnisse mit Neunmeterschießen', async () => {
    const s = store();
    const live = s.get(TID)!.matches.find((m) => m.status === 'live')!;
    await s.setMatchStatus(TID, live.id, 'completed');
    const changes = buildStageModel(s.get(TID)!)!.resolution.changes;
    await s.confirmSlotFills(TID, changes.map((c) => ({ matchId: c.matchId, side: c.side, teamId: c.toTeamId })));
    const sf1 = s.get(TID)!.matches.find((m) => m.matchKey === 'SF1')!;
    await s.finishKnockoutMatch(TID, sf1.id, { goalsA: 1, goalsB: 1, decidedBy: 'penalties', penaltiesA: 4, penaltiesB: 3 });
    const done = s.get(TID)!.matches.find((m) => m.id === sf1.id)!;
    const f = s.get(TID)!.tournament.format!;
    expect(resultText(done, f)).toBe('1:1, 4:3 n. N.');
    const model = buildStageModel(s.get(TID)!)!;
    const final = s.get(TID)!.matches.find((m) => m.matchKey === 'F')!;
    expect(model.resolution.changes).toContainEqual({ matchId: final.id, side: 'A', fromTeamId: null, toTeamId: done.teamAId });
  });
});
