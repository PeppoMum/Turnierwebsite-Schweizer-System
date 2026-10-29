import { FORMAT_TEMPLATES } from '../../domain/format';
import { createFixtures } from './fixtures';
import { describeHistory } from './history';
import { MockTournamentStore } from './mockStore';
import type { WizardDraft } from './types';
import { undoChecks } from './undo';

const TID = 'sommercup';

function store() {
  return new MockTournamentStore(createFixtures(), false);
}

const data = (s: MockTournamentStore) => s.get(TID)!;
const match = (s: MockTournamentStore, key: string) => data(s).matches.find((m) => m.matchKey === key)!;
const latest = async (s: MockTournamentStore) => (await s.loadHistory(TID))[0]!;

/** Halbfinale mit Teams belegen, wie es nach „Endrunde füllen bestätigen“ aussieht. */
async function fillSemis(s: MockTournamentStore) {
  const [a, b] = data(s).groupDraws![0]!.groups;
  await s.confirmSlotFills(TID, [
    { matchId: match(s, 'SF1').id, side: 'A', teamId: a![0]! },
    { matchId: match(s, 'SF1').id, side: 'B', teamId: b![1]! },
    { matchId: match(s, 'SF2').id, side: 'A', teamId: b![0]! },
    { matchId: match(s, 'SF2').id, side: 'B', teamId: a![1]! },
  ]);
}

function draft(patch: Partial<WizardDraft> = {}): WizardDraft {
  return {
    id: 'neu',
    title: 'Pfingstturnier',
    organizerName: 'FC Test',
    venue: '',
    localDate: '2027-05-15',
    timeZone: 'Europe/Berlin',
    sponsors: [],
    teams: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n) => ({ id: `d-${n}`, name: `Team ${n}`, active: true })),
    roundsTotal: 0,
    preDrawRounds: 0,
    pairingMode: 'balanced',
    tieBreakers: [],
    buchholzEnabled: false,
    fields: [{ id: 'f1', name: 'Platz 1' }],
    startTime: '10:00',
    matchMinutes: 10,
    turnoverMinutes: 2,
    roundBreakMinutes: 0,
    restOptimization: true,
    hardRestMinutes: null,
    allocation: 'max_capacity',
    visibility: 'full',
    ...patch,
  };
}

describe('Baukasten in der Datenhaltung', () => {
  it('legt ein Turnier mit Ablauf an: keine Schweizer-System-Runde, Zuschauer sehen erst nach dem Veröffentlichen etwas', async () => {
    const s = store();
    const format = FORMAT_TEMPLATES[0]!.build();
    const ids = draft().teams.map((t) => t.id);
    const tid = await s.createTournament(
      draft({ format, groupDraws: [{ stageId: 'vorrunde', mode: 'manual', groups: [ids.slice(0, 4), ids.slice(4)] }] }),
      false,
    );
    const d = s.get(tid)!;
    expect(d.tournament.format).toEqual(format);
    expect(d.rounds).toHaveLength(0);
    // Team-IDs aus dem Assistenten werden auf die gespeicherten umgestellt.
    expect(d.groupDraws![0]!.groups.flat().sort()).toEqual(d.teams.map((t) => t.id).sort());
    expect(s.getPublic(tid)).toBeUndefined();

    await s.saveStagePlan(tid, [
      { stageId: 'vorrunde', groupIndex: 0, teamAId: d.teams[0]!.id, teamBId: d.teams[1]!.id, durationMinutes: 10 },
      { stageId: 'endrunde', matchKey: 'F', slotA: { kind: 'winner', stageId: 'endrunde', matchKey: 'SF1' }, slotB: { kind: 'winner', stageId: 'endrunde', matchKey: 'SF2' }, durationMinutes: 10 },
    ]);
    await s.publishTournament(tid);
    const pub = s.getPublic(tid)!;
    expect(pub.format).toEqual(format);
    expect(pub.matches).toHaveLength(2);
    expect(pub.matches[1]).toMatchObject({ matchKey: 'F', teamAId: '', slotA: { kind: 'winner', matchKey: 'SF1' } });
    expect(pub.standings).toBeUndefined();
  });

  it('prüft die Gruppeneinteilung', async () => {
    const s = store();
    const [a, b] = data(s).groupDraws![0]!.groups;
    // In der Vorrunde wurde schon gespielt.
    await expect(s.saveGroupDraw(TID, { stageId: 'vorrunde', mode: 'manual', groups: [b!, a!] })).rejects.toThrow(/schon gespielt/);
    await expect(s.saveGroupDraw(TID, { stageId: 'endrunde', mode: 'manual', groups: [a!] })).rejects.toThrow(/keine Gruppen/);

    const tid = await s.createTournament(draft({ format: FORMAT_TEMPLATES[0]!.build() }), false);
    const ids = s.get(tid)!.teams.map((t) => t.id);
    await expect(s.saveGroupDraw(tid, { stageId: 'vorrunde', mode: 'manual', groups: [ids.slice(0, 4), ids.slice(3, 7)] })).rejects.toThrow(/zwei Gruppen/);
    await expect(s.saveGroupDraw(tid, { stageId: 'vorrunde', mode: 'manual', groups: [ids.slice(0, 4), ids.slice(4, 7)] })).rejects.toThrow(/Noch nicht eingeteilt: Team H/);
    await s.saveGroupDraw(tid, { stageId: 'vorrunde', mode: 'random', seed: 1, groups: [ids.slice(0, 4), ids.slice(4)] });
    await s.saveGroupDraw(tid, { stageId: 'vorrunde', mode: 'random', seed: 2, groups: [ids.slice(4), ids.slice(0, 4)] });

    // Die neue Auslosung lässt sich zurücknehmen.
    const entries = await s.loadHistory(tid);
    const check = undoChecks(entries, s.get(tid)!).get(entries[0]!.id);
    expect(check).toMatchObject({ ok: true, plan: { kind: 'group-draw' } });
    await s.undoHistory(tid, entries[0]!);
    expect(s.get(tid)!.groupDraws![0]!.groups[0]).toEqual(ids.slice(0, 4));
  });

  it('Ergebnis erst, wenn beide Teams feststehen; Endrunde braucht einen Sieger', async () => {
    const s = store();
    const sf1 = match(s, 'SF1');
    await expect(s.recordScore(TID, sf1.id, 1, 0)).rejects.toThrow(/stehen noch nicht fest/);
    await fillSemis(s);
    await s.recordScore(TID, sf1.id, 1, 1);
    await expect(s.setMatchStatus(TID, sf1.id, 'completed')).rejects.toThrow(/Sieger/);
    await expect(s.finishKnockoutMatch(TID, sf1.id, { goalsA: 1, goalsB: 1, decidedBy: 'regular' })).rejects.toThrow(/Sieger/);
    await expect(s.finishKnockoutMatch(TID, sf1.id, { goalsA: 2, goalsB: 1, decidedBy: 'extra_time' })).rejects.toThrow(/keine Verlängerung/);
    await expect(s.finishKnockoutMatch(TID, sf1.id, { goalsA: 1, goalsB: 1, decidedBy: 'penalties', penaltiesA: 3, penaltiesB: 3 })).rejects.toThrow(/mehr Treffer/);
    await s.finishKnockoutMatch(TID, sf1.id, { goalsA: 1, goalsB: 1, decidedBy: 'penalties', penaltiesA: 4, penaltiesB: 3 });
    expect(match(s, 'SF1')).toMatchObject({ status: 'completed', decidedBy: 'penalties', penaltiesA: 4, penaltiesB: 3 });

    const lines = describeHistory(await s.loadHistory(TID), data(s));
    expect(lines[0]!.text).toMatch(/1:1, 4:3 n\. N\./);
    expect(lines[0]!.text).toMatch(/Endrunde/);

    // Rückgängig stellt auch die Entscheidung zurück.
    await s.undoHistory(TID, await latest(s));
    expect(match(s, 'SF1')).toMatchObject({ status: 'live', goalsA: 1, goalsB: 1 });
    expect(match(s, 'SF1').decidedBy).toBeUndefined();

    // Ohne Gleichstand reicht „beendet“.
    await s.recordScore(TID, sf1.id, 2, 1);
    await s.setMatchStatus(TID, sf1.id, 'completed');
    expect(match(s, 'SF1').decidedBy).toBe('regular');
  });

  it('reine Neunmeterspiele nur mit Neunmeterschießen', async () => {
    const s = store();
    const p3 = match(s, 'P3');
    const [a, b] = data(s).groupDraws![0]!.groups;
    await s.confirmSlotFills(TID, [
      { matchId: p3.id, side: 'A', teamId: a![0]! },
      { matchId: p3.id, side: 'B', teamId: b![0]! },
    ]);
    await expect(s.finishKnockoutMatch(TID, p3.id, { goalsA: 1, goalsB: 0, decidedBy: 'regular' })).rejects.toThrow(/nur per Neunmeter/);
    await s.finishKnockoutMatch(TID, p3.id, { goalsA: 0, goalsB: 0, decidedBy: 'penalties', penaltiesA: 5, penaltiesB: 4 });
  });

  it('tauscht Spiele und Gegner, sperrt laufende Spiele, und alles ist rückgängig machbar', async () => {
    const s = store();
    const sf1 = match(s, 'SF1');
    const f = match(s, 'F');
    await s.swapMatches(TID, sf1.id, f.id);
    expect(match(s, 'SF1')).toMatchObject({ startISO: f.startISO, fieldId: f.fieldId, manual: true });
    expect(match(s, 'F')).toMatchObject({ startISO: sf1.startISO, fieldId: sf1.fieldId, manual: true });

    const live = data(s).matches.find((m) => m.status === 'live')!;
    await expect(s.swapMatches(TID, live.id, f.id)).rejects.toThrow(/angepfiffen/);
    await expect(s.moveMatch(TID, live.id, { fieldId: data(s).fields[0]!.id })).rejects.toThrow(/angepfiffen/);

    await s.swapTeams(TID, { matchId: sf1.id, side: 'B' }, { matchId: match(s, 'SF2').id, side: 'B' });
    expect(match(s, 'SF1').slotB).toEqual({ kind: 'group_place', stageId: 'vorrunde', group: 0, place: 2 });
    expect(match(s, 'SF2').slotB).toEqual({ kind: 'group_place', stageId: 'vorrunde', group: 1, place: 2 });

    let entries = await s.loadHistory(TID);
    expect(describeHistory(entries, data(s))[0]!.text).toMatch(/^Gegner getauscht/);
    await s.undoHistory(TID, entries[0]!);
    expect(match(s, 'SF1').slotB).toEqual(sf1.slotB);

    // Der Tausch der Spiele davor: gleiche Spiele, aber der Rückgängig-Schritt hat sie nicht verändert.
    entries = await s.loadHistory(TID);
    const swap = entries.find((e) => e.action === 'match.swap')!;
    await s.undoHistory(TID, swap);
    expect(match(s, 'SF1')).toMatchObject({ startISO: sf1.startISO, fieldId: sf1.fieldId });
    expect(match(s, 'SF1').manual).toBeUndefined();
  });

  it('Uhrzeit und Feld von Hand ändern', async () => {
    const s = store();
    const f = match(s, 'F');
    const later = new Date(Date.parse(f.startISO!) + 15 * 60000).toISOString();
    await s.moveMatch(TID, f.id, { startISO: later, fieldId: data(s).fields[0]!.id });
    expect(match(s, 'F')).toMatchObject({ startISO: later, fieldId: data(s).fields[0]!.id, manual: true });
    await expect(s.moveMatch(TID, f.id, { fieldId: 'gibt-es-nicht' })).rejects.toThrow(/Feld/);
  });

  it('neuer Spielplan ersetzt nur offene Spiele', async () => {
    const s = store();
    const started = data(s).matches.filter((m) => m.status !== 'scheduled').length;
    const ids = await s.saveStagePlan(TID, [
      { stageId: 'endrunde', matchKey: 'F', slotA: { kind: 'winner', stageId: 'endrunde', matchKey: 'SF1' }, slotB: { kind: 'winner', stageId: 'endrunde', matchKey: 'SF2' }, durationMinutes: 12 },
    ]);
    expect(data(s).matches).toHaveLength(started + 1);
    expect(data(s).matches.find((m) => m.id === ids[0])).toMatchObject({ roundId: `${TID}-endrunde`, roundNumber: 2, teamAId: '', status: 'scheduled' });
    await expect(s.saveStagePlan(TID, [{ stageId: 'gibt-es-nicht', durationMinutes: 10, teamAId: 'x' }])).rejects.toThrow(/Abschnitt/);
  });

  it('Rückzug eines qualifizierten Teams: kampflos oder Nachrücker', async () => {
    const s = store();
    await fillSemis(s);
    const sf1 = match(s, 'SF1');
    const out = sf1.teamAId;

    const other = data(s).teams.find((t) => !data(s).matches.some((m) => m.stageId === 'endrunde' && (m.teamAId === t.id || m.teamBId === t.id)))!;
    await expect(s.withdrawQualifiedTeam(TID, out, { kind: 'replace', byTeamId: sf1.teamBId })).rejects.toThrow(/schon mit/);
    await s.withdrawQualifiedTeam(TID, out, { kind: 'replace', byTeamId: other.id });
    expect(match(s, 'SF1')).toMatchObject({ teamAId: other.id, slotA: { kind: 'team', teamId: other.id } });
    expect(data(s).teams.find((t) => t.id === out)!.status).toBe('withdrawn');

    const s2 = store();
    await fillSemis(s2);
    await s2.withdrawQualifiedTeam(TID, out, { kind: 'walkover' });
    expect(match(s2, 'SF1')).toMatchObject({ status: 'not_played', decidedBy: 'walkover', walkoverWinner: 'B', teamAId: out });
    const entries = await s2.loadHistory(TID);
    const lines = describeHistory(entries, data(s2));
    expect(lines.some((l) => /Gegner kampflos weiter/.test(l.text))).toBe(true);
    // Den Rückzug zuerst zurücknehmen (neuester Eintrag), dann die kampflose Wertung.
    await s2.undoHistory(TID, entries[0]!);
    const walk = (await s2.loadHistory(TID)).find((e) => e.action === 'team.withdraw_qualified')!;
    await s2.undoHistory(TID, walk);
    expect(match(s2, 'SF1')).toMatchObject({ status: 'scheduled', teamAId: out });
    expect(match(s2, 'SF1').decidedBy).toBeUndefined();
    expect(match(s2, 'SF1').walkoverWinner).toBeUndefined();
  });

  it('Lose werden gespeichert und für dieselben Teams ersetzt', async () => {
    const s = store();
    const [a] = data(s).groupDraws![0]!.groups;
    await s.saveLot(TID, { stageId: 'vorrunde', groupIndex: 0, order: [a![0]!, a![1]!] });
    await s.saveLot(TID, { stageId: 'vorrunde', groupIndex: 0, order: [a![1]!, a![0]!] });
    expect(data(s).lots).toHaveLength(1);
    expect(data(s).lots![0]!.order[0]).toBe(a![1]);
    expect(s.getPublic(TID)!.lots).toHaveLength(1);
  });

  it('Schweizer-System-Turniere bleiben unberührt', async () => {
    const s = store();
    await expect(s.publishTournament('herbstcup')).rejects.toThrow(/Gruppen oder Endrunde/);
    const pub = s.getPublic('herbstcup')!;
    expect(pub.format).toBeUndefined();
    expect(pub.standings).toBeDefined();
    expect(pub.matches.every((m) => m.stageId === undefined)).toBe(true);
  });

  it('Kinderfußball: keine Neunmeter-Treffer für Zuschauer', async () => {
    const s = store();
    await s.setVisibility(TID, 'kids');
    await fillSemis(s);
    await s.finishKnockoutMatch(TID, match(s, 'SF1').id, { goalsA: 0, goalsB: 0, decidedBy: 'penalties', penaltiesA: 2, penaltiesB: 1 });
    const pm = s.getPublic(TID)!.matches.find((m) => m.matchKey === 'SF1')!;
    expect(pm).toMatchObject({ decidedBy: 'penalties' });
    expect(pm.penaltiesA).toBeUndefined();
    expect(pm.goalsA).toBeUndefined();
  });
});
