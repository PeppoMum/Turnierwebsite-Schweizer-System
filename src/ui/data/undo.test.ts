import { createFixtures } from './fixtures';
import { MockTournamentStore } from './mockStore';
import { describeHistory } from './history';
import { undoChecks } from './undo';

const TID = 'herbstcup';

function store() {
  return new MockTournamentStore(createFixtures(), false);
}

async function latest(s: MockTournamentStore) {
  return (await s.loadHistory(TID))[0]!;
}

async function checkOf(s: MockTournamentStore, id: string) {
  return undoChecks(await s.loadHistory(TID), s.get(TID)!).get(id);
}

describe('Rückgängig im Verlauf', () => {
  it('nimmt einen Endstand zurück, danach steht das Spiel wieder wie vorher', async () => {
    const s = store();
    const live = s.get(TID)!.matches.find((m) => m.status === 'live')!;
    await s.setMatchStatus(TID, live.id, 'completed');
    const entry = await latest(s);
    const check = await checkOf(s, entry.id);
    expect(check).toMatchObject({ ok: true, explain: expect.stringContaining('läuft, Stand 1:0') });

    await s.undoHistory(TID, entry);
    expect(s.get(TID)!.matches.find((m) => m.id === live.id)).toMatchObject({ status: 'live', goalsA: 1, goalsB: 0 });

    const entries = await s.loadHistory(TID);
    const lines = describeHistory(entries, s.get(TID)!);
    expect(lines[0]!.text).toMatch(/^Rückgängig gemacht: Endstand: /);
    expect(lines.find((l) => l.id === entry.id)!.undone).toBe(true);
    // Der zurückgenommene Schritt lässt sich nicht noch einmal zurücknehmen, der Rückgängig-Schritt schon.
    const checks = undoChecks(entries, s.get(TID)!);
    expect(checks.get(entry.id)?.ok).toBe(false);
    expect(checks.get(entries[0]!.id)?.ok).toBe(true);
  });

  it('nur die letzte Änderung eines Spiels lässt sich zurücknehmen', async () => {
    const s = store();
    const live = s.get(TID)!.matches.find((m) => m.status === 'live')!;
    await s.recordScore(TID, live.id, 2, 0);
    const first = await latest(s);
    await s.recordScore(TID, live.id, 3, 0);
    expect(await checkOf(s, first.id)).toMatchObject({ ok: false, reason: expect.stringContaining('letzte Änderung') });
    await expect(s.undoHistory(TID, first)).rejects.toThrow(/geändert/);
  });

  it('lehnt ab, wenn sich das Spiel inzwischen anders geändert hat', async () => {
    const s = store();
    const live = s.get(TID)!.matches.find((m) => m.status === 'live')!;
    await s.recordScore(TID, live.id, 2, 0);
    const entry = await latest(s);
    // Die Prüfung im Speicher kennt nur den aktuellen Stand: der Zustandsvergleich fängt das ab.
    await s.markNotPlayed(TID, live.id, 'other');
    await expect(s.undoHistory(TID, entry)).rejects.toThrow(/geändert/);
  });

  it('warnt bei Ergebnissen aus Runden, nach denen schon ausgelost wurde', async () => {
    const s = store();
    const r1 = s.get(TID)!.matches.find((m) => m.roundNumber === 1 && m.status === 'completed')!;
    await s.recordScore(TID, r1.id, (r1.goalsA ?? 0) + 1, r1.goalsB ?? 0);
    const entry = await latest(s);
    const check = await checkOf(s, entry.id);
    expect(check).toMatchObject({ ok: true, warning: expect.stringContaining('Runde 2 ist schon ausgelost') });
    await s.undoHistory(TID, entry);
    expect(s.get(TID)!.matches.find((m) => m.id === r1.id)).toMatchObject({ status: 'completed', goalsA: r1.goalsA, goalsB: r1.goalsB });
  });

  it('kein offenes Spiel in einer abgeschlossenen Runde', async () => {
    const s = store();
    const r1 = s.get(TID)!.matches.find((m) => m.roundNumber === 1 && m.status === 'completed')!;
    await s.reopenMatch(TID, r1.id);
    const entry = await latest(s);
    // Wiedereröffnen zurücknehmen ist erlaubt (Spiel wieder beendet) …
    expect(await checkOf(s, entry.id)).toMatchObject({ ok: true });
    await s.undoHistory(TID, entry);
    // … den Rückgängig-Schritt erneut zurücknehmen nicht (Runde 1 ist abgeschlossen).
    const redo = await latest(s);
    expect(await checkOf(s, redo.id)).toMatchObject({ ok: false, reason: expect.stringContaining('abgeschlossen') });
  });

  it('Abmeldung zurücknehmen: Mannschaft spielt wieder mit, ausgefallene Spiele sind wieder geplant', async () => {
    const s = store();
    const d = s.get(TID)!;
    const open = d.matches.find((m) => m.roundNumber === 2 && m.status === 'scheduled')!;
    await s.withdrawTeam(TID, open.teamAId);
    expect(s.get(TID)!.matches.find((m) => m.id === open.id)!.status).toBe('not_played');
    const entry = await latest(s);
    expect(await checkOf(s, entry.id)).toMatchObject({ ok: true, explain: expect.stringContaining('wieder geplant') });

    await s.undoHistory(TID, entry);
    const after = s.get(TID)!;
    expect(after.teams.find((t) => t.id === open.teamAId)!.status).toBe('active');
    expect(after.matches.find((m) => m.id === open.id)).toMatchObject({ status: 'scheduled', notPlayedReason: undefined });
    const lines = describeHistory(await s.loadHistory(TID), after);
    expect(lines[0]!.text).toMatch(/^Rückgängig gemacht: .* zurückgezogen$/);
  });

  it('Umbenennung, Sichtbarkeit und Zeitverschiebung zurücknehmen', async () => {
    const s = store();
    const team = s.get(TID)!.teams[0]!;
    await s.saveTeam(TID, team.id, { name: 'Neuer Name' });
    await s.undoHistory(TID, await latest(s));
    expect(s.get(TID)!.teams[0]!.name).toBe(team.name);

    await s.setVisibility(TID, 'kids');
    await s.undoHistory(TID, await latest(s));
    expect(s.get(TID)!.tournament.visibility).toBe('full');

    const scheduled = s.get(TID)!.matches.find((m) => m.status === 'scheduled')!;
    await s.shiftFutureMatches(TID, 10);
    const shift = await latest(s);
    await s.undoHistory(TID, shift);
    expect(s.get(TID)!.matches.find((m) => m.id === scheduled.id)!.startISO).toBe(scheduled.startISO);
    // Dieselbe Verschiebung lässt sich nicht zweimal zurücknehmen.
    expect(await checkOf(s, shift.id)).toMatchObject({ ok: false });
  });

  it('Turnierdaten: nur Name, Veranstalter, Ort, Datum; Datum nicht mehr nach der Auslosung', async () => {
    const s = store();
    const d = s.get(TID)!;
    const { detailsOf } = await import('./details');
    await s.updateDetails(TID, { ...detailsOf(d), title: 'Anderer Name', venue: '' });
    await s.undoHistory(TID, await latest(s));
    expect(s.get(TID)!.tournament).toMatchObject({ title: d.tournament.title, venue: d.tournament.venue });
  });

  it('Runde abschließen und Turnierende zurücknehmen', async () => {
    const s = store();
    const d = s.get(TID)!;
    for (const m of d.matches.filter((x) => x.roundNumber === 2 && x.status !== 'completed')) {
      await s.setMatchStatus(TID, m.id, 'completed');
    }
    await s.closeCurrentRound(TID);
    await s.undoHistory(TID, await latest(s));
    expect(s.get(TID)!.rounds.find((r) => r.number === 2)!.status).toBe('active');

    await s.finishTournament(TID);
    await s.undoHistory(TID, await latest(s));
    expect(s.get(TID)!.tournament.status).toBe('running');
  });

  it('ausgeloste Runden lassen sich nicht zurücknehmen', async () => {
    const s = store();
    const entry = { id: 'x', atISO: new Date().toISOString(), actorUid: 'u', action: 'round.publish', targetType: 'round', targetId: 'herbstcup-r2' };
    expect(undoChecks([entry], s.get(TID)!).get('x')).toMatchObject({ ok: false });
    await expect(s.undoHistory(TID, entry)).rejects.toThrow(/öffentlich/);
  });
});
