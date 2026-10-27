import { createFixtures } from './fixtures';
import { MockTournamentStore } from './mockStore';
import { detailsOf, validateDetails } from './details';
import { describeHistory } from './history';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function store() {
  return new MockTournamentStore(createFixtures(), false);
}

describe('Turnierdaten nachträglich ändern', () => {
  it('ändert Name, Ort und Sponsoren und zeigt sie öffentlich', async () => {
    const s = store();
    const d = s.get('herbstcup')!;
    const details = detailsOf(d);
    await s.updateDetails('herbstcup', {
      ...details,
      title: '  Herbstcup 2026 Finaltag ',
      venue: '',
      organizerLogo: PNG,
      sponsors: [...details.sponsors.slice(1), { id: 'neu-1', name: 'Metzgerei', url: '', logo: PNG }],
    });
    const after = s.get('herbstcup')!;
    expect(after.tournament.title).toBe('Herbstcup 2026 Finaltag');
    expect(after.tournament.venue).toBeUndefined();
    expect(after.assets[after.tournament.organizerAssetId!]).toBe(PNG);
    expect(after.sponsors.map((x) => x.name)).toEqual(['Autohaus Nord', 'Stadtwerke', 'Metzgerei']);
    expect(after.sponsors.map((x) => x.order)).toEqual([0, 1, 2]);
    const pub = s.getPublic('herbstcup')!;
    expect(pub.tournament.title).toBe('Herbstcup 2026 Finaltag');
    expect(pub.organizerLogo).toBe(PNG);
    expect(pub.sponsors.at(-1)).toMatchObject({ name: 'Metzgerei', logo: PNG });
  });

  it('lässt das Datum nur vor der ersten Runde ändern und verschiebt dann die Startzeit mit', async () => {
    const s = store();
    const running = s.get('herbstcup')!;
    const moved = { ...detailsOf(running), localDate: '2030-05-01' };
    expect(validateDetails(running, moved).localDate).toMatch(/nicht mehr ändern/);
    await expect(s.updateDetails('herbstcup', moved)).rejects.toThrow(/nicht mehr ändern/);

    const draft = s.get('wintercup')!;
    const local = (iso: string) =>
      new Intl.DateTimeFormat('sv-SE', { timeZone: draft.tournament.timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
    const timeBefore = local(draft.tournament.schedule.tournamentStartISO).slice(11);
    await s.updateDetails('wintercup', { ...detailsOf(draft), localDate: '2027-01-23' });
    const after = s.get('wintercup')!;
    expect(after.tournament.localDate).toBe('2027-01-23');
    expect(local(after.tournament.schedule.tournamentStartISO)).toBe(`2027-01-23 ${timeBefore}`);
  });

  it('verlangt Name, Veranstalter und gültige Sponsorlinks', () => {
    const d = store().get('wintercup')!;
    const e = validateDetails(d, { ...detailsOf(d), title: ' ', organizerName: '', sponsors: [{ id: 'x', name: 'A', url: 'http://a.de' }] });
    expect(Object.keys(e).sort()).toEqual(['organizerName', 'sponsor-0', 'title']);
  });
});

describe('Mannschaften ändern und nachmelden', () => {
  it('benennt um, setzt ein Logo und lehnt doppelte Namen ab', async () => {
    const s = store();
    const [a, b] = s.get('herbstcup')!.teams;
    await s.saveTeam('herbstcup', a!.id, { name: 'Neuer Name', logo: PNG });
    const after = s.get('herbstcup')!.teams.find((t) => t.id === a!.id)!;
    expect(after.name).toBe('Neuer Name');
    expect(s.get('herbstcup')!.assets[after.logoAssetId!]).toBe(PNG);
    await expect(s.saveTeam('herbstcup', b!.id, { name: 'neuer name' })).rejects.toThrow(/schon eine Mannschaft/);
    await expect(s.saveTeam('herbstcup', b!.id, { name: '  ' })).rejects.toThrow(/Namen/);
  });

  it('nimmt eine nachgemeldete Mannschaft in die nächste Runde auf', async () => {
    const s = store();
    await s.saveTeam('herbstcup', null, { name: 'Spätstarter' });
    let d = s.get('herbstcup')!;
    const late = d.teams.find((t) => t.name === 'Spätstarter')!;
    expect(late.status).toBe('active');
    expect(new Set(d.teams.map((t) => t.id)).size).toBe(d.teams.length);
    for (const m of d.matches.filter((x) => x.status !== 'completed')) await s.setMatchStatus('herbstcup', m.id, 'completed');
    await s.closeCurrentRound('herbstcup');
    d = s.get('herbstcup')!;
    const preview = s.previewNextRound('herbstcup', 1);
    const placed = preview.pairs.some((p) => p.teamAId === late.id || p.teamBId === late.id) || preview.byeTeamId === late.id;
    expect(placed).toBe(true);
    expect(s.getPublic('herbstcup')!.standings!.some((r) => r.teamId === late.id)).toBe(true);
  });
});

describe('Änderungsverlauf', () => {
  it('hält Änderungen fest, neueste zuerst', async () => {
    const s = store();
    const m = s.get('herbstcup')!.matches.find((x) => x.status === 'live')!;
    await s.recordScore('herbstcup', m.id, 2, 0);
    await s.setMatchStatus('herbstcup', m.id, 'completed');
    await s.saveTeam('herbstcup', null, { name: 'Spätstarter' });
    const h = await s.loadHistory('herbstcup');
    expect(h.map((e) => e.action)).toEqual(['team.add', 'match.result.final', 'match.result.live']);
    expect(h[2]).toMatchObject({ targetId: m.id, before: { goalsA: 1, goalsB: 0 }, after: { goalsA: 2, goalsB: 0 } });

    await s.recordScore('herbstcup', m.id, 3, 0);
    await s.updateDetails('herbstcup', { ...detailsOf(s.get('herbstcup')!), title: 'Neu' });
    const d = s.get('herbstcup')!;
    const name = (id: string) => d.teams.find((t) => t.id === id)!.name;
    const lines = describeHistory(await s.loadHistory('herbstcup'), d, 'local');
    expect(lines.map((l) => l.text)).toEqual([
      'Turnierdaten geändert: Name „Herbstcup 2026“ → „Neu“',
      `Ergebnis korrigiert: ${name(m.teamAId)} – ${name(m.teamBId)} (Runde 2) 3:0 (vorher 2:0)`,
      'Mannschaft nachgemeldet: Spätstarter',
      `Endstand: ${name(m.teamAId)} – ${name(m.teamBId)} (Runde 2) 2:0`,
      `Zwischenstand: ${name(m.teamAId)} – ${name(m.teamBId)} (Runde 2) 2:0`,
    ]);
    expect(lines.every((l) => l.who === 'Du')).toBe(true);
    expect(lines.filter((l) => l.isResult)).toHaveLength(3);
  });
});
