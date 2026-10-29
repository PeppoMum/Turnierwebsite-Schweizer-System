import { createFixtures } from './fixtures';
import { MockTournamentStore } from './mockStore';
import { EDITED_NOTE, planRound, renumberWaves, slotClashes, swapInPreview } from './roundEdit';

const TID = 'herbstcup';

async function nextRound() {
  const s = new MockTournamentStore(createFixtures(), false);
  for (const m of s.get(TID)!.matches.filter((x) => x.status !== 'completed')) await s.setMatchStatus(TID, m.id, 'completed');
  await s.closeCurrentRound(TID);
  const preview = s.previewNextRound(TID, 1);
  const lastStart = Math.max(...s.get(TID)!.matches.map((m) => Date.parse(m.startISO!)));
  const startISO = new Date(lastStart + 3 * 3600_000).toISOString();
  return { s, preview, startISO };
}

describe('Rundenvorschau von Hand anpassen', () => {
  it('tauscht zwei Teams zwischen Spielen und zählt Wiederholungen neu', async () => {
    const { s, preview } = await nextRound();
    const d = s.get(TID)!;
    const [p0, p1] = preview.pairs;
    const next = swapInPreview(d, preview, { pair: 0, side: 'B' }, { pair: 1, side: 'A' });
    expect(next.pairs[0]).toMatchObject({ teamAId: p0!.teamAId, teamBId: p1!.teamAId });
    expect(next.pairs[1]).toMatchObject({ teamAId: p0!.teamBId, teamBId: p1!.teamBId });
    expect(next.diagnostics.warnings).toEqual([EDITED_NOTE]);
    expect(next.diagnostics.repeats).toBe(next.pairs.filter((p) => p.repeat > 0).length);
    // Gegner im selben Spiel tauschen ändert nichts.
    expect(swapInPreview(d, preview, { pair: 0, side: 'A' }, { pair: 0, side: 'B' })).toBe(preview);
  });

  it('gibt das Freilos an ein anderes Team', async () => {
    const { s, preview } = await nextRound();
    if (!preview.byeTeamId) return; // Fixture mit gerader Teamzahl: kein Freilos.
    const old = preview.byeTeamId;
    const next = swapInPreview(s.get(TID)!, preview, { pair: 'bye' }, { pair: 0, side: 'A' });
    expect(next.byeTeamId).toBe(preview.pairs[0]!.teamAId);
    expect(next.pairs[0]!.teamAId).toBe(old);
  });

  it('veröffentlicht von Hand gesetzte Felder und Zeiten', async () => {
    const { s, preview, startISO } = await nextRound();
    const d = s.get(TID)!;
    const auto = planRound(d, preview, startISO);
    const later = new Date(Date.parse(startISO) + 60 * 60000).toISOString();
    const slots = renumberWaves(auto.map((x, i) => (i === 0 ? { fieldId: x.fieldId, startISO: later } : x)));
    expect(slotClashes(d, slots, String)).toEqual([]);
    await s.publishRound(TID, preview, startISO, slots);
    const after = s.get(TID)!;
    const first = after.matches.find((m) => m.roundNumber === preview.roundNumber && m.teamAId === preview.pairs[0]!.teamAId)!;
    expect(first.startISO).toBe(later);
    expect(first.waveIndex).toBe(Math.max(...slots.map((x) => x.waveIndex)));
  });

  it('meldet ein doppelt belegtes Feld', async () => {
    const { s, preview, startISO } = await nextRound();
    const d = s.get(TID)!;
    const auto = planRound(d, preview, startISO);
    const clash = renumberWaves(auto.map((x, i) => (i === 1 ? { fieldId: auto[0]!.fieldId, startISO: auto[0]!.startISO } : x)));
    expect(slotClashes(d, clash, (i) => `Spiel ${i + 1}`)[0]).toMatch(/Spiel 1 und Spiel 2 sind gleichzeitig/);
  });
});
