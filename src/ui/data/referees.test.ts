import { createFixtures } from './fixtures';
import { MockTournamentStore } from './mockStore';
import { openReports, reportState } from './referees';

const TID = 'sommercup';

function store() {
  return new MockTournamentStore(createFixtures(), false);
}

const data = (s: MockTournamentStore) => s.get(TID)!;
const match = (s: MockTournamentStore, key: string) => data(s).matches.find((m) => m.matchKey === key)!;
// Im Beispiel läuft gerade das letzte Gruppenspiel.
const groupMatch = (s: MockTournamentStore) => data(s).matches.find((m) => m.stageId === 'vorrunde' && m.status === 'live')!;

describe('Schiris in der Datenhaltung', () => {
  it('Schiris tragen sich ein, teilen Spiele auf; Spiele und Verlauf bleiben unverändert', async () => {
    const s = store();
    const before = data(s);
    const anna = await s.saveReferee(TID, '  Anna  ');
    const ben = await s.saveReferee(TID, 'Ben');
    expect(data(s).referees!.map((r) => r.name)).toEqual(['Anna', 'Ben']);
    const m = groupMatch(s);
    await s.assignReferees(TID, [{ matchId: m.id, refereeId: anna }]);
    expect(data(s).refereeing).toEqual([{ matchId: m.id, refereeId: anna }]);
    await s.assignReferees(TID, [{ matchId: m.id, refereeId: ben }]);
    expect(data(s).refereeing![0]!.refereeId).toBe(ben);
    expect(data(s).matches).toEqual(before.matches);
    expect(data(s).tournament.revision).toBe(before.tournament.revision);
    expect(await s.loadHistory(TID)).toEqual([]);
  });

  it('prüft Namen und unbekannte Schiris', async () => {
    const s = store();
    await expect(s.saveReferee(TID, '   ')).rejects.toThrow('Namen');
    await expect(s.saveReferee(TID, 'x'.repeat(41))).rejects.toThrow('40');
    await expect(s.assignReferees(TID, [{ matchId: groupMatch(s).id, refereeId: 'gibts-nicht' }])).rejects.toThrow('Schiri');
  });

  it('Austragen gibt die Spiele des Schiris frei', async () => {
    const s = store();
    const anna = await s.saveReferee(TID, 'Anna');
    const m = groupMatch(s);
    await s.assignReferees(TID, [{ matchId: m.id, refereeId: anna }]);
    await s.removeReferee(TID, anna);
    expect(data(s).referees).toEqual([]);
    expect(data(s).refereeing![0]!.refereeId).toBeUndefined();
  });

  it('eine Meldung zählt erst nach „Übernehmen“', async () => {
    const s = store();
    const anna = await s.saveReferee(TID, 'Anna');
    const m = groupMatch(s);
    await s.reportRefereeResult(TID, m.id, { refereeId: anna, goalsA: 2, goalsB: 1 });
    expect(data(s).matches.find((x) => x.id === m.id)!.status).toBe('live');
    expect(openReports(data(s)).map((r) => r.match.id)).toEqual([m.id]);

    await s.acceptRefereeReport(TID, m.id);
    const after = data(s).matches.find((x) => x.id === m.id)!;
    expect(after).toMatchObject({ status: 'completed', goalsA: 2, goalsB: 1 });
    expect(reportState(after, data(s).refereeing![0]!.report!)).toBe('accepted');
    expect(openReports(data(s))).toEqual([]);
  });

  it('weicht die Turnierleitung ab, gilt ihr Ergebnis; Meldung zurücknehmen geht', async () => {
    const s = store();
    const anna = await s.saveReferee(TID, 'Anna');
    const m = groupMatch(s);
    await s.reportRefereeResult(TID, m.id, { refereeId: anna, goalsA: 2, goalsB: 1 });
    await s.recordScore(TID, m.id, 0, 0);
    await s.setMatchStatus(TID, m.id, 'completed');
    expect(reportState(data(s).matches.find((x) => x.id === m.id)!, data(s).refereeing![0]!.report!)).toBe('differs');
    await s.reportRefereeResult(TID, m.id, null);
    expect(data(s).refereeing![0]!.report).toBeUndefined();
  });

  it('Endrunde: Unentschieden braucht Neunmeter, „Übernehmen“ beendet das Spiel mit Sieger', async () => {
    const s = store();
    const anna = await s.saveReferee(TID, 'Anna');
    const [a, b] = data(s).groupDraws![0]!.groups;
    const sf1 = match(s, 'SF1');
    await s.confirmSlotFills(TID, [
      { matchId: sf1.id, side: 'A', teamId: a![0]! },
      { matchId: sf1.id, side: 'B', teamId: b![1]! },
    ]);
    await expect(s.reportRefereeResult(TID, sf1.id, { refereeId: anna, goalsA: 1, goalsB: 1 })).rejects.toThrow('Neunmeter');
    await s.reportRefereeResult(TID, sf1.id, { refereeId: anna, goalsA: 1, goalsB: 1, decidedBy: 'penalties', penaltiesA: 4, penaltiesB: 3 });
    await s.acceptRefereeReport(TID, sf1.id);
    expect(match(s, 'SF1')).toMatchObject({ status: 'completed', decidedBy: 'penalties', penaltiesA: 4, penaltiesB: 3 });
  });

  it('Schiri-Link an, aus und neu', async () => {
    const s = store();
    await s.setOpenRefereeLink(TID, 'on');
    const first = data(s).tournament.openRefereeLinkId;
    expect(first).toBeTruthy();
    await s.setOpenRefereeLink(TID, 'renew');
    expect(data(s).tournament.openRefereeLinkId).not.toBe(first);
    await s.setOpenRefereeLink(TID, 'off');
    expect(data(s).tournament.openRefereeLinkId).toBeNull();
  });
});
