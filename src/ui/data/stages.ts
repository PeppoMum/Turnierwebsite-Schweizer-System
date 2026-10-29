// Turnier-Baukasten in der Datenhaltung: Prüfungen und Änderungen, die mockStore und firestoreStore
// gleich machen. Die Fachlogik (Auslosung, Tabellen, Platzhalter auflösen, Spielplan) liegt in
// src/domain; hier wird nur geprüft, ob eine Änderung erlaubt ist, und sie auf die Daten angewendet.
//
// Grundsätze (docs/turnier-baukasten.md):
// - Angepfiffene und beendete Spiele lassen sich nicht mehr verschieben, tauschen oder neu besetzen.
// - Jede Änderung an Ort, Zeit oder Gegnern merkt sich den Stand davor und danach (`LayoutSnap`),
//   damit der Verlauf sie zurücknehmen kann.
import type { Match, Team } from '../../domain';
import type { GroupStage, SlotRef, StageConfig } from '../../domain/format';
import type { GroupDraw, KnockoutResult, MatchMove, MatchSide, PlannedStageMatch, SlotFill, TournamentData, WithdrawalChoice } from './types';

/** Was an einem Spiel von Hand geändert werden kann (für Verlauf und Rückgängig). */
export interface LayoutSnap {
  id: string;
  teamAId: string;
  teamBId: string;
  slotA: SlotRef | null;
  slotB: SlotRef | null;
  fieldId: string | null;
  startISO: string | null;
  waveIndex: number | null;
  manual: boolean;
}

export const NOT_FOUND = 'Turnier nicht gefunden';
const STARTED = 'Das Spiel ist schon angepfiffen oder vorbei und lässt sich nicht mehr ändern.';

export function layoutSnap(m: Match): LayoutSnap {
  return {
    id: m.id,
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    slotA: m.slotA ?? null,
    slotB: m.slotB ?? null,
    fieldId: m.fieldId ?? null,
    startISO: m.startISO ?? null,
    waveIndex: m.waveIndex ?? null,
    manual: m.manual ?? false,
  };
}

export function applyLayoutSnap(m: Match, s: LayoutSnap): void {
  m.teamAId = s.teamAId;
  m.teamBId = s.teamBId;
  m.slotA = s.slotA ?? undefined;
  m.slotB = s.slotB ?? undefined;
  m.fieldId = s.fieldId ?? undefined;
  m.startISO = s.startISO ?? undefined;
  m.waveIndex = s.waveIndex ?? undefined;
  m.manual = s.manual || undefined;
}

export function sameLayout(a: LayoutSnap, b: LayoutSnap): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function stageOf(d: TournamentData, stageId: string | undefined): StageConfig | undefined {
  return d.tournament.format?.stages.find((s) => s.id === stageId);
}

export function assertFormat(d: TournamentData): void {
  if (!d.tournament.format) throw new Error('Das geht nur bei Turnieren mit Gruppen oder Endrunde.');
}

function findMatch(d: TournamentData, matchId: string): Match {
  const m = d.matches.find((x) => x.id === matchId);
  if (!m) throw new Error('Spiel nicht gefunden.');
  return m;
}

/** Noch nicht angepfiffen: nur dann darf sich an Ort, Zeit und Gegnern etwas ändern. */
export function isOpen(m: Match): boolean {
  return m.status === 'scheduled' || m.status === 'draft';
}

function openMatch(d: TournamentData, matchId: string): Match {
  const m = findMatch(d, matchId);
  if (!isOpen(m)) throw new Error(STARTED);
  return m;
}

/** Ein Ergebnis braucht zwei feststehende Teams. */
export function assertPlayable(d: TournamentData, matchId: string): void {
  const m = d.matches.find((x) => x.id === matchId);
  if (m && (!m.teamAId || !m.teamBId)) throw new Error('Die Teams für dieses Spiel stehen noch nicht fest.');
}

function isKnockoutLike(d: TournamentData, m: Match): boolean {
  const kind = stageOf(d, m.stageId)?.kind;
  return kind === 'knockout' || kind === 'placement';
}

/**
 * „Beendet“ für ein Endrunden-Spiel ohne Neunmeter: ein Unentschieden geht dort nicht.
 * Gibt `decidedBy` zurück, das gesetzt werden soll (undefined = kein Endrunden-Spiel).
 */
export function checkFinishWithoutDecider(d: TournamentData, matchId: string): Match['decidedBy'] {
  const m = d.matches.find((x) => x.id === matchId);
  if (!m || !isKnockoutLike(d, m)) return undefined;
  if (m.penaltyOnly || (m.goalsA ?? 0) === (m.goalsB ?? 0)) {
    throw new Error('In der Endrunde braucht es einen Sieger. Bitte Verlängerung oder Neunmeterschießen eintragen.');
  }
  return m.decidedBy === 'extra_time' ? 'extra_time' : 'regular';
}

export function checkKnockoutResult(d: TournamentData, matchId: string, r: KnockoutResult): void {
  const m = findMatch(d, matchId);
  if (!isKnockoutLike(d, m)) throw new Error('Verlängerung und Neunmeter gibt es nur in der Endrunde.');
  if (!m.teamAId || !m.teamBId) throw new Error('Die Teams für dieses Spiel stehen noch nicht fest.');
  const whole = (n: number | undefined) => n !== undefined && Number.isInteger(n) && n >= 0;
  if (!whole(r.goalsA) || !whole(r.goalsB)) throw new Error('Tore müssen ganze Zahlen ab 0 sein.');
  if (r.decidedBy === 'penalties') {
    if (!whole(r.penaltiesA) || !whole(r.penaltiesB)) throw new Error('Bitte die Treffer im Neunmeterschießen eintragen.');
    if (r.penaltiesA === r.penaltiesB) throw new Error('Im Neunmeterschießen muss ein Team mehr Treffer haben.');
    if (r.goalsA !== r.goalsB) throw new Error('Neunmeterschießen gibt es nur bei Unentschieden.');
    return;
  }
  if (m.penaltyOnly) throw new Error('Dieses Spiel wird nur per Neunmeterschießen entschieden.');
  if (r.goalsA === r.goalsB) throw new Error('In der Endrunde braucht es einen Sieger. Bitte Neunmeterschießen eintragen.');
  if (r.decidedBy === 'extra_time' && stageOf(d, m.stageId) && drawDeciderOf(d, m) !== 'extra_time_then_penalties') {
    throw new Error('Für diese Endrunde ist keine Verlängerung eingestellt.');
  }
}

function drawDeciderOf(d: TournamentData, m: Match): string | undefined {
  const s = stageOf(d, m.stageId);
  return s && (s.kind === 'knockout' || s.kind === 'placement') ? s.drawDecider : undefined;
}

export function applyKnockoutResult(m: Match, r: KnockoutResult, nowISO: string): void {
  m.goalsA = r.goalsA;
  m.goalsB = r.goalsB;
  m.decidedBy = r.decidedBy;
  m.penaltiesA = r.decidedBy === 'penalties' ? r.penaltiesA : undefined;
  m.penaltiesB = r.decidedBy === 'penalties' ? r.penaltiesB : undefined;
  if (m.status !== 'completed') m.completedAt = nowISO;
  m.status = 'completed';
  m.notPlayedReason = undefined;
}

/** Teams, die eingeteilt werden dürfen (alle gemeldeten, auch zurückgezogene, damit alte Einteilungen gültig bleiben). */
function eligibleTeams(d: TournamentData): Team[] {
  return d.teams.filter((t) => t.status !== 'inactive');
}

/** Prüft eine Gruppeneinteilung und gibt sie bereinigt zurück. */
export function checkGroupDraw(d: TournamentData, draw: Omit<GroupDraw, 'updatedAt'>): Omit<GroupDraw, 'updatedAt'> {
  assertFormat(d);
  const stage = stageOf(d, draw.stageId);
  if (!stage || stage.kind !== 'groups') throw new Error('Dieser Abschnitt hat keine Gruppen.');
  const g = stage as GroupStage;
  if (draw.groups.length !== g.groupCount) throw new Error(`Es müssen genau ${g.groupCount} Gruppen sein.`);
  if (draw.groups.some((x) => x.length < 2)) throw new Error('Jede Gruppe braucht mindestens 2 Teams.');
  const known = new Set(eligibleTeams(d).map((t) => t.id));
  const seen = new Set<string>();
  for (const id of draw.groups.flat()) {
    if (!known.has(id)) throw new Error('Ein Team in der Einteilung gehört nicht zu diesem Turnier.');
    if (seen.has(id)) throw new Error('Ein Team steht in zwei Gruppen.');
    seen.add(id);
  }
  if (stage.entry === null) {
    const missing = d.teams.filter((t) => t.status === 'active' && !seen.has(t.id));
    if (missing.length > 0) throw new Error(`Noch nicht eingeteilt: ${missing.map((t) => t.name).join(', ')}.`);
  }
  if (d.matches.some((m) => m.stageId === draw.stageId && !isOpen(m))) {
    throw new Error('In diesem Abschnitt wurde schon gespielt. Die Gruppen lassen sich nicht mehr ändern.');
  }
  return {
    stageId: draw.stageId,
    groups: draw.groups.map((x) => [...x]),
    mode: draw.mode,
    ...(draw.pots ? { pots: draw.pots.map((x) => [...x]) } : {}),
    ...(draw.seed !== undefined ? { seed: draw.seed } : {}),
  };
}

/** Einteilung setzen; Team-IDs der Spiele dieses Abschnitts, die noch offen sind, ziehen nicht automatisch nach. */
export function applyGroupDraw(d: TournamentData, draw: Omit<GroupDraw, 'updatedAt'>, nowISO: string): GroupDraw | null {
  const list = d.groupDraws ?? [];
  const before = list.find((x) => x.stageId === draw.stageId) ?? null;
  d.groupDraws = [...list.filter((x) => x.stageId !== draw.stageId), { ...draw, updatedAt: nowISO }];
  return before;
}

export function roundIdOf(tid: string, stageId: string): string {
  return `${tid}-${stageId}`;
}

/**
 * Spielplan des Baukastens ersetzen. Angepfiffene und beendete Spiele bleiben, wie sie sind (auch wenn
 * sie im neuen Plan anders stehen); alle anderen Baukasten-Spiele werden durch den Plan ersetzt.
 * Schweizer-System-Spiele bleiben unberührt. Gibt die IDs der neuen offenen Spiele zurück.
 */
export function applyStagePlan(d: TournamentData, plan: PlannedStageMatch[], newId: () => string, nowISO: string): string[] {
  assertFormat(d);
  const tid = d.tournament.id;
  const kept = d.matches.filter((m) => !m.stageId || !isOpen(m));
  const keptIds = new Set(kept.map((m) => m.id));
  const teamIds = new Set(d.teams.map((t) => t.id));
  const fieldIds = new Set(d.fields.map((f) => f.id));
  const old = new Map(d.matches.map((m) => [m.id, m]));
  const ids: string[] = [];
  const added: Match[] = [];
  for (const p of plan) {
    if (p.id && keptIds.has(p.id)) continue;
    const stage = stageOf(d, p.stageId);
    if (!stage) throw new Error('Ein Spiel gehört zu keinem Abschnitt dieses Turniers.');
    for (const t of [p.teamAId, p.teamBId]) if (t && !teamIds.has(t)) throw new Error('Ein Spiel enthält ein unbekanntes Team.');
    if (p.fieldId && !fieldIds.has(p.fieldId)) throw new Error('Ein Spiel liegt auf einem unbekannten Feld.');
    if (!p.teamAId && !p.slotA) throw new Error('Jede Seite eines Spiels braucht ein Team oder einen Platzhalter.');
    if (!p.teamBId && !p.slotB) throw new Error('Jede Seite eines Spiels braucht ein Team oder einen Platzhalter.');
    const id = p.id ?? newId();
    const prev = old.get(id);
    const m: Match = {
      id,
      roundId: roundIdOf(tid, stage.id),
      roundNumber: stage.phase + 1,
      teamAId: p.teamAId ?? '',
      teamBId: p.teamBId ?? '',
      fieldId: p.fieldId,
      waveIndex: p.waveIndex,
      startISO: p.startISO,
      durationMinutes: p.durationMinutes,
      status: 'scheduled',
      stageId: stage.id,
      groupIndex: p.groupIndex,
      matchKey: p.matchKey,
      slotA: p.slotA,
      slotB: p.slotB,
      penaltyOnly: p.penaltyOnly,
      manual: p.manual || undefined,
      revision: (prev?.revision ?? 0) + 1,
      createdAt: prev?.createdAt ?? nowISO,
      updatedAt: nowISO,
    };
    // Leere Felder weglassen, damit Firestore keine undefined-Werte sieht.
    for (const k of Object.keys(m) as (keyof Match)[]) if (m[k] === undefined) delete m[k];
    ids.push(id);
    added.push(m);
  }
  d.matches = [...kept, ...added];
  return ids;
}

/** Zwei Spiele tauschen Uhrzeit und Feld. */
export function swapMatchesIn(d: TournamentData, idA: string, idB: string): { before: LayoutSnap[]; after: LayoutSnap[] } {
  if (idA === idB) throw new Error('Bitte zwei verschiedene Spiele wählen.');
  const a = openMatch(d, idA);
  const b = openMatch(d, idB);
  const before = [layoutSnap(a), layoutSnap(b)];
  const pa = { fieldId: a.fieldId, startISO: a.startISO, waveIndex: a.waveIndex };
  a.fieldId = b.fieldId;
  a.startISO = b.startISO;
  a.waveIndex = b.waveIndex;
  b.fieldId = pa.fieldId;
  b.startISO = pa.startISO;
  b.waveIndex = pa.waveIndex;
  a.manual = true;
  b.manual = true;
  return { before, after: [layoutSnap(a), layoutSnap(b)] };
}

function sideGet(m: Match, side: 'A' | 'B'): { teamId: string; slot?: SlotRef } {
  return side === 'A' ? { teamId: m.teamAId, slot: m.slotA } : { teamId: m.teamBId, slot: m.slotB };
}

function sideSet(m: Match, side: 'A' | 'B', v: { teamId: string; slot?: SlotRef }): void {
  if (side === 'A') {
    m.teamAId = v.teamId;
    m.slotA = v.slot;
  } else {
    m.teamBId = v.teamId;
    m.slotB = v.slot;
  }
}

/** Zwei Teams (bzw. Platzhalter) zwischen zwei noch nicht angepfiffenen Spielen tauschen. */
export function swapSidesIn(d: TournamentData, x: MatchSide, y: MatchSide): { before: LayoutSnap[]; after: LayoutSnap[] } {
  if (x.matchId === y.matchId && x.side === y.side) throw new Error('Bitte zwei verschiedene Teams wählen.');
  const a = openMatch(d, x.matchId);
  const b = openMatch(d, y.matchId);
  const touched = a === b ? [a] : [a, b];
  const before = touched.map(layoutSnap);
  const va = sideGet(a, x.side);
  const vb = sideGet(b, y.side);
  sideSet(a, x.side, vb);
  sideSet(b, y.side, va);
  for (const m of touched) {
    if (m.teamAId && m.teamAId === m.teamBId) throw new Error('Ein Team kann nicht gegen sich selbst spielen.');
    m.manual = true;
  }
  return { before, after: touched.map(layoutSnap) };
}

/** Feld oder Uhrzeit eines Spiels von Hand ändern. */
export function moveMatchIn(d: TournamentData, matchId: string, move: MatchMove): { before: LayoutSnap[]; after: LayoutSnap[] } {
  const m = openMatch(d, matchId);
  if (move.fieldId !== undefined && !d.fields.some((f) => f.id === move.fieldId)) throw new Error('Dieses Feld gibt es nicht.');
  if (move.startISO !== undefined && Number.isNaN(Date.parse(move.startISO))) throw new Error('Ungültige Uhrzeit.');
  const before = [layoutSnap(m)];
  if (move.fieldId !== undefined) m.fieldId = move.fieldId;
  if (move.startISO !== undefined) m.startISO = new Date(move.startISO).toISOString();
  m.manual = true;
  return { before, after: [layoutSnap(m)] };
}

/** Bestätigte Endrunden-Füllung eintragen: Team auf die Seite setzen, Platzhalter bleibt zur Anzeige. */
export function fillSlotsIn(d: TournamentData, fills: SlotFill[]): { before: LayoutSnap[]; after: LayoutSnap[] } {
  if (fills.length === 0) throw new Error('Nichts zum Eintragen.');
  const known = new Set(d.teams.map((t) => t.id));
  const touched = new Map<string, Match>();
  const before: LayoutSnap[] = [];
  for (const f of fills) {
    if (!known.has(f.teamId)) throw new Error('Unbekanntes Team.');
    const m = openMatch(d, f.matchId);
    if (!touched.has(m.id)) {
      touched.set(m.id, m);
      before.push(layoutSnap(m));
    }
    if (f.side === 'A') m.teamAId = f.teamId;
    else m.teamBId = f.teamId;
  }
  for (const m of touched.values()) {
    if (m.teamAId && m.teamAId === m.teamBId) throw new Error('Ein Team kann nicht gegen sich selbst spielen.');
  }
  return { before, after: [...touched.values()].map(layoutSnap) };
}

/**
 * Qualifiziertes Team zieht vor seinem Endrunden-Spiel zurück. `walkover`: seine offenen Endrunden-Spiele
 * werden kampflos für den Gegner gewertet (Status `not_played`, Grund `withdrawal`, `decidedBy: walkover`;
 * Sieger ist das andere Team). `replace`: ein Nachrücker übernimmt seine offenen Endrunden-Spiele.
 * Offene Gruppenspiele behandelt der normale Rückzug (withdrawTeam).
 */
export function withdrawQualifiedIn(
  d: TournamentData,
  teamId: string,
  choice: WithdrawalChoice,
): { before: LayoutSnap[]; after: LayoutSnap[]; matchIds: string[] } {
  assertFormat(d);
  if (!d.teams.some((t) => t.id === teamId)) throw new Error('Unbekanntes Team.');
  const finals = d.matches.filter((m) => m.stageId && stageOf(d, m.stageId)?.kind !== 'groups' && isOpen(m) && (m.teamAId === teamId || m.teamBId === teamId));
  if (finals.length === 0) throw new Error('Dieses Team hat kein offenes Endrunden-Spiel.');
  const before = finals.map(layoutSnap);
  if (choice.kind === 'replace') {
    const by = d.teams.find((t) => t.id === choice.byTeamId);
    if (!by || by.id === teamId) throw new Error('Bitte ein anderes Team als Nachrücker wählen.');
    const stages = new Set(finals.map((m) => m.stageId));
    if (d.matches.some((m) => stages.has(m.stageId) && (m.teamAId === by.id || m.teamBId === by.id))) {
      throw new Error(`${by.name} spielt in dieser Endrunde schon mit.`);
    }
    for (const m of finals) {
      if (m.teamAId === teamId) m.teamAId = by.id;
      if (m.teamBId === teamId) m.teamBId = by.id;
      m.manual = true;
    }
  } else {
    for (const m of finals) {
      m.status = 'not_played';
      m.notPlayedReason = 'withdrawal';
      m.decidedBy = 'walkover';
    }
  }
  return { before, after: finals.map(layoutSnap), matchIds: finals.map((m) => m.id) };
}
