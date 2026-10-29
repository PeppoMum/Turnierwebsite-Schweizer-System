// Schweizer System: Rundenvorschau vor dem Veröffentlichen von Hand anpassen (Gegner und Freilos
// tauschen, Feld und Uhrzeit je Spiel). Beide Stores planen die Runde über `planRound`, damit
// Vorschau und gespeicherte Runde dieselben Zeiten haben.
import { MeetingCounter, collectMeetings } from '../../domain/pairing';
import { createWaveSchedule } from '../../domain/schedule';
import type { PairingPreview, TournamentData } from './types';

/** Feld und Anstoß eines Spiels der Vorschau, in der Reihenfolge von `preview.pairs`. */
export interface RoundSlot {
  fieldId: string;
  startISO: string;
  waveIndex: number;
}

/** Ein Platz in der Vorschau: Seite A/B eines Spiels oder das Freilos. */
export type PreviewSpot = { pair: number; side: 'A' | 'B' } | { pair: 'bye' };

export function teamAt(preview: PairingPreview, spot: PreviewSpot): string | undefined {
  if (spot.pair === 'bye') return preview.byeTeamId;
  const p = preview.pairs[spot.pair];
  return spot.side === 'A' ? p?.teamAId : p?.teamBId;
}

export function sameSpot(a: PreviewSpot, b: PreviewSpot): boolean {
  return a.pair === b.pair && (a.pair === 'bye' || (b.pair !== 'bye' && a.side === b.side));
}

/**
 * Zwei Teams der Vorschau tauschen ihre Plätze (auch mit dem Freilos). Wiederholungen werden neu
 * gezählt; die Vorschau merkt sich in den Hinweisen, dass sie von Hand geändert wurde.
 */
export function swapInPreview(d: TournamentData, preview: PairingPreview, x: PreviewSpot, y: PreviewSpot): PairingPreview {
  const a = teamAt(preview, x);
  const b = teamAt(preview, y);
  if (!a || !b || sameSpot(x, y)) return preview;
  if (x.pair !== 'bye' && y.pair !== 'bye' && x.pair === y.pair) return preview;
  const pairs = preview.pairs.map((p) => ({ ...p }));
  let byeTeamId = preview.byeTeamId;
  const put = (spot: PreviewSpot, team: string) => {
    if (spot.pair === 'bye') byeTeamId = team;
    else if (spot.side === 'A') pairs[spot.pair]!.teamAId = team;
    else pairs[spot.pair]!.teamBId = team;
  };
  put(x, b);
  put(y, a);
  return recount(d, { ...preview, pairs, ...(byeTeamId ? { byeTeamId } : {}) });
}

export const EDITED_NOTE = 'Paarungen von Hand geändert.';

function recount(d: TournamentData, preview: PairingPreview): PairingPreview {
  const excluded = d.teams.filter((t) => t.status !== 'active').map((t) => t.id);
  const counter = new MeetingCounter(
    collectMeetings(d.matches, { excludedTeamIds: excluded, excludeRoundNumbers: [preview.roundNumber] }),
  );
  const pairs = preview.pairs.map((p) => ({ ...p, repeat: counter.count(p.teamAId, p.teamBId) }));
  // Nur die Grundwerte übernehmen: Erklärungen und Alternativen des Algorithmus passen nicht mehr.
  const old = preview.diagnostics;
  const diagnostics: PairingPreview['diagnostics'] = {
    objectiveCost: old.objectiveCost,
    repeats: pairs.filter((p) => p.repeat > 0).length,
    tripleEncounters: pairs.filter((p) => p.repeat >= 2).length,
    meanQuotientGap: old.meanQuotientGap,
    maxQuotientGap: old.maxQuotientGap,
    warnings: [EDITED_NOTE],
  };
  if (preview.byeTeamId) diagnostics.byeTeamId = preview.byeTeamId;
  return { ...preview, pairs, diagnostics };
}

/** Hatte das Freilos-Team in dieser Vorschau schon in einer früheren Runde ein Freilos? */
export function hadByeBefore(d: TournamentData, teamId: string | undefined): boolean {
  return !!teamId && d.byes.some((b) => b.teamId === teamId);
}

/**
 * Felder und Anstoßzeiten für die Spiele der Vorschau planen (wie beim Veröffentlichen). Wirft bei
 * Problemen, die eine Veröffentlichung verhindern würden, eine verständliche Meldung.
 */
export function planRound(d: TournamentData, preview: PairingPreview, startISO: string): RoundSlot[] {
  const s = d.tournament.schedule;
  // Letztes Spielende je Team, damit die Planung Pausen über die Rundengrenze hinweg berücksichtigt.
  const teamLastEndISO: Record<string, string> = {};
  for (const m of d.matches) {
    if (!m.startISO || m.status === 'not_played' || m.status === 'cancelled') continue;
    const end = new Date(new Date(m.startISO).getTime() + m.durationMinutes * 60000).toISOString();
    for (const id of [m.teamAId, m.teamBId]) if (!teamLastEndISO[id] || teamLastEndISO[id]! < end) teamLastEndISO[id] = end;
  }
  const keys = preview.pairs.map((_, i) => `p${i + 1}`);
  const plan = createWaveSchedule(
    [
      {
        roundNumber: preview.roundNumber,
        startISO,
        matches: preview.pairs.map((p, i) => ({ id: keys[i]!, teamAId: p.teamAId, teamBId: p.teamBId })),
      },
    ],
    d.fields,
    {
      tournamentStartISO: s.tournamentStartISO,
      matchMinutes: s.matchMinutes,
      turnoverMinutes: s.turnoverMinutes,
      roundBreakMinutes: s.roundBreakMinutes,
      optionalHardRestMinutes: s.optionalHardRestMinutes,
      evenRest: s.evenRest,
      allocation: s.allocation,
    },
    { teamLastEndISO, teamNames: new Map(d.teams.map((t) => [t.id, t.name])) },
  );
  if (plan.problems.length > 0) throw new Error(plan.problems.join(' '));
  const slot = new Map(plan.matches.map((m) => [m.matchId, m]));
  return keys.map((k) => {
    const m = slot.get(k);
    if (!m) throw new Error('Die Runde ließ sich nicht planen.');
    return { fieldId: m.fieldId, startISO: m.startISO, waveIndex: m.waveIndex };
  });
}

/** Wellen nach Anstoßzeit neu durchzählen, damit Live-Ansicht und Zuschauer sie richtig gruppieren. */
export function renumberWaves(slots: readonly Omit<RoundSlot, 'waveIndex'>[]): RoundSlot[] {
  const times = [...new Set(slots.map((s) => s.startISO))].sort();
  return slots.map((s) => ({ fieldId: s.fieldId, startISO: s.startISO, waveIndex: times.indexOf(s.startISO) }));
}

/** Spiele der Vorschau, die sich auf demselben Feld zeitlich überschneiden (Text je Konflikt). */
export function slotClashes(d: TournamentData, slots: readonly RoundSlot[], label: (i: number) => string): string[] {
  const min = d.tournament.schedule.matchMinutes;
  const out: string[] = [];
  const fieldName = (id: string) => d.fields.find((f) => f.id === id)?.name ?? 'Feld';
  const ms = (iso: string) => new Date(iso).getTime();
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i]!;
      const b = slots[j]!;
      if (a.fieldId !== b.fieldId) continue;
      if (ms(a.startISO) < ms(b.startISO) + min * 60000 && ms(b.startISO) < ms(a.startISO) + min * 60000) {
        out.push(`${label(i)} und ${label(j)} sind gleichzeitig auf ${fieldName(a.fieldId)}.`);
      }
    }
  }
  // Schon veröffentlichte Spiele, die noch nicht vorbei sind, belegen ihr Feld ebenfalls.
  for (const m of d.matches) {
    if (!m.startISO || !m.fieldId || m.status === 'cancelled' || m.status === 'not_played' || m.status === 'draft') continue;
    slots.forEach((s, i) => {
      if (s.fieldId !== m.fieldId) return;
      if (ms(s.startISO) < ms(m.startISO!) + m.durationMinutes * 60000 && ms(m.startISO!) < ms(s.startISO) + min * 60000) {
        out.push(`${label(i)} überschneidet sich auf ${fieldName(s.fieldId)} mit einem Spiel aus Runde ${m.roundNumber}.`);
      }
    });
  }
  return out;
}
