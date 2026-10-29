// Turnier-Baukasten in der Datenhaltung: Prüfungen und Änderungen, die mockStore und firestoreStore
// gleich machen. Die Fachlogik (Auslosung, Tabellen, Platzhalter auflösen, Spielplan) liegt in
// src/domain; hier wird nur geprüft, ob eine Änderung erlaubt ist, und sie auf die Daten angewendet.
//
// Grundsätze (docs/turnier-baukasten.md):
// - Angepfiffene und beendete Spiele lassen sich nicht mehr verschieben, tauschen oder neu besetzen.
// - Jede Änderung an Ort, Zeit oder Gegnern merkt sich den Stand davor und danach (`LayoutSnap`),
//   damit der Verlauf sie zurücknehmen kann.
import type { Match, Team, TeamStatus } from '../../domain';
import type { GroupStage, SlotRef, StageConfig, TournamentFormat } from '../../domain/format';
import { scoredWalkover, type ScoredWalkover } from '../../domain/groups/walkover';
import { validateFormat } from '../../domain/knockout';
import type { MatchPlacement } from '../../domain/schedule';
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
  /** Spieldauer; fehlt bei älteren Verlaufseinträgen (dann wird sie nicht verglichen). */
  durationMinutes?: number;
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
    durationMinutes: m.durationMinutes,
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
  if (typeof s.durationMinutes === 'number') m.durationMinutes = s.durationMinutes;
}

export function sameLayout(a: LayoutSnap, b: LayoutSnap): boolean {
  const plain = (s: LayoutSnap) => {
    const { durationMinutes: _d, ...rest } = s;
    void _d;
    return JSON.stringify(rest);
  };
  if (a.durationMinutes === undefined || b.durationMinutes === undefined) return plain(a) === plain(b);
  return plain(a) === plain(b) && a.durationMinutes === b.durationMinutes;
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

export function isKnockoutLike(d: TournamentData, m: Match): boolean {
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

/**
 * Ergebnis eines schon beendeten Endrunden-Spiels korrigieren: Sieger muss bleiben. Liefert die neue
 * Entscheidung, `undefined` = unverändert lassen (kein Endrunden-Spiel oder Gleichstand nach Neunmetern).
 */
export function scoreEditDecision(
  d: TournamentData,
  matchId: string,
  goalsA: number,
  goalsB: number,
): { decidedBy: 'regular' | 'extra_time' } | undefined {
  const m = d.matches.find((x) => x.id === matchId);
  if (!m || m.status !== 'completed' || !isKnockoutLike(d, m)) return undefined;
  if (goalsA === goalsB) {
    if (m.decidedBy === 'penalties') return undefined;
    throw new Error('In der Endrunde braucht es einen Sieger. Bitte Neunmeterschießen eintragen.');
  }
  if (m.penaltyOnly) throw new Error('Dieses Spiel wird nur per Neunmeterschießen entschieden.');
  return { decidedBy: m.decidedBy === 'extra_time' ? 'extra_time' : 'regular' };
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

/**
 * Gruppenspiel kampflos werten (Team kommt nicht, bleibt aber im Turnier): nur Baukasten-Spiele
 * außerhalb der Endrunde, die noch nicht beendet sind und deren Teams beide noch dabei sind.
 * Gibt das Ergebnis zurück (2:0 für `winner`).
 */
export function checkWalkover(d: TournamentData, matchId: string, winner: 'A' | 'B'): ScoredWalkover {
  assertFormat(d);
  const m = findMatch(d, matchId);
  if (!m.stageId) throw new Error('Kampflos werten geht nur bei Turnieren mit Gruppen oder Endrunde.');
  if (isKnockoutLike(d, m)) throw new Error('In der Endrunde kommt ein Team über „Rückzug“ kampflos weiter.');
  if (!m.teamAId || !m.teamBId) throw new Error('Die Teams für dieses Spiel stehen noch nicht fest.');
  if (m.status !== 'scheduled' && m.status !== 'live') throw new Error('Das Spiel ist schon vorbei. Korrigiere es zuerst.');
  if (winner !== 'A' && winner !== 'B') throw new Error('Bitte angeben, welches Team kampflos gewinnt.');
  const out = [m.teamAId, m.teamBId].find((id) => d.teams.find((t) => t.id === id)?.status !== 'active');
  if (out) throw new Error(`${d.teams.find((t) => t.id === out)?.name ?? 'Ein Team'} ist abgemeldet. Dessen Spiele zählen ohnehin nicht.`);
  return scoredWalkover(winner);
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

/**
 * Von Hand gesetzte Teams als Platzhalter `team` festhalten, damit eine Neuberechnung der Endrunde
 * sie stehen lässt (src/domain/knockout/README.md).
 */
function pinTeams(m: Match): void {
  if (m.teamAId) m.slotA = { kind: 'team', teamId: m.teamAId };
  if (m.teamBId) m.slotB = { kind: 'team', teamId: m.teamBId };
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
    pinTeams(m);
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

/**
 * Mehrere noch nicht angepfiffene Spiele auf einmal neu setzen (Plan straffen, Dreiergruppe spielt länger).
 * Anders als beim Tauschen von Hand bleibt `manual` unverändert, damit ein späteres Straffen sie wieder bewegen darf.
 */
export function placeMatchesIn(d: TournamentData, placements: readonly MatchPlacement[]): { before: LayoutSnap[]; after: LayoutSnap[] } {
  assertFormat(d);
  if (placements.length === 0) throw new Error('Es gibt nichts zu ändern.');
  const touched: Match[] = [];
  const before: LayoutSnap[] = [];
  for (const p of placements) {
    const m = openMatch(d, p.matchId);
    if (!m.stageId) throw new Error('Das geht nur bei Spielen mit Gruppen oder Endrunde.');
    if (!d.fields.some((f) => f.id === p.fieldId)) throw new Error('Dieses Feld gibt es nicht.');
    if (Number.isNaN(Date.parse(p.startISO))) throw new Error('Ungültige Uhrzeit.');
    if (p.durationMinutes !== undefined && (!Number.isInteger(p.durationMinutes) || p.durationMinutes < 1 || p.durationMinutes > 240)) {
      throw new Error('Die Spielzeit muss zwischen 1 und 240 Minuten liegen.');
    }
    if (touched.includes(m)) continue;
    before.push(layoutSnap(m));
    m.fieldId = p.fieldId;
    m.startISO = new Date(p.startISO).toISOString();
    if (p.waveIndex !== undefined) m.waveIndex = p.waveIndex;
    if (p.durationMinutes !== undefined) m.durationMinutes = p.durationMinutes;
    touched.push(m);
  }
  return { before, after: touched.map(layoutSnap) };
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
 * werden kampflos für den Gegner gewertet (Status `not_played`, Grund `withdrawal`, `decidedBy: walkover`,
 * `walkoverWinner` = die Seite des Gegners). `replace`: ein Nachrücker übernimmt seine offenen Endrunden-Spiele.
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
    // Spielt der Nachrücker bisher in einem anderen Abschnitt derselben Runde (z. B. Platzierungsspiel),
    // wird er dort herausgenommen; die Lücke füllt die Turnierleitung danach.
    const phases = new Set(finals.map((m) => stageOf(d, m.stageId)?.phase));
    const elsewhere = d.matches.filter(
      (m) =>
        m.stageId &&
        !stages.has(m.stageId) &&
        stageOf(d, m.stageId)?.kind !== 'groups' &&
        phases.has(stageOf(d, m.stageId)?.phase) &&
        (m.teamAId === by.id || m.teamBId === by.id),
    );
    if (elsewhere.some((m) => !isOpen(m))) throw new Error(`${by.name} hat in dieser Runde schon gespielt und kann nicht nachrücken.`);
    for (const m of elsewhere) {
      before.push(layoutSnap(m));
      for (const side of ['A', 'B'] as const) {
        const v = sideGet(m, side);
        if (v.teamId !== by.id) continue;
        const pinned = v.slot?.kind === 'team' && v.slot.teamId === by.id;
        sideSet(m, side, { teamId: '', slot: pinned ? undefined : v.slot });
      }
      m.manual = true;
    }
    finals.push(...elsewhere);
    for (const m of finals) {
      if (elsewhere.includes(m)) continue;
      if (m.teamAId === teamId) {
        m.teamAId = by.id;
        m.slotA = { kind: 'team', teamId: by.id };
      }
      if (m.teamBId === teamId) {
        m.teamBId = by.id;
        m.slotB = { kind: 'team', teamId: by.id };
      }
      m.manual = true;
    }
  } else {
    for (const m of finals) {
      m.status = 'not_played';
      m.notPlayedReason = 'withdrawal';
      m.decidedBy = 'walkover';
      m.walkoverWinner = m.teamAId === teamId ? 'B' : 'A';
    }
  }
  return { before, after: finals.map(layoutSnap), matchIds: finals.map((m) => m.id) };
}

// ---------- Turnier umstellen (src/domain/format/reshape.ts) ----------

/** Stand, den „Turnier umstellen“ setzt bzw. „Rückgängig“ wiederherstellt. */
export interface ReshapeState {
  format: TournamentFormat;
  /** Einteilung der Vorrunde; `null` = bleibt, wie sie ist. */
  draw: Omit<GroupDraw, 'updatedAt'> | null;
  teamStatus: { id: string; status: TeamStatus }[];
  /** Alle noch nicht angepfiffenen Baukasten-Spiele danach (mit ID, wenn sie bleiben). */
  plan: PlannedStageMatch[];
}

/** Noch nicht angepfiffene Baukasten-Spiele in der Form, die `applyStagePlan` speichert. */
export function openStagePlan(d: TournamentData): PlannedStageMatch[] {
  return d.matches
    .filter((m) => m.stageId && isOpen(m))
    .map((m) => {
      const p: PlannedStageMatch = {
        id: m.id,
        stageId: m.stageId!,
        groupIndex: m.groupIndex,
        matchKey: m.matchKey,
        teamAId: m.teamAId || undefined,
        teamBId: m.teamBId || undefined,
        slotA: m.slotA,
        slotB: m.slotB,
        penaltyOnly: m.penaltyOnly,
        fieldId: m.fieldId,
        startISO: m.startISO,
        waveIndex: m.waveIndex,
        durationMinutes: m.durationMinutes,
        manual: m.manual,
      };
      for (const k of Object.keys(p) as (keyof PlannedStageMatch)[]) if (p[k] === undefined) delete p[k];
      return p;
    });
}

/** Jetziger Stand für die Teams `teamIds` (die sich ändern). */
export function reshapeSnapshot(d: TournamentData, teamIds: readonly string[]): ReshapeState {
  assertFormat(d);
  const first = d.tournament.format!.stages[0]!;
  const draw = d.groupDraws?.find((g) => g.stageId === first.id);
  return {
    format: structuredClone(d.tournament.format!),
    draw: draw ? { stageId: draw.stageId, groups: draw.groups.map((g) => [...g]), mode: draw.mode } : null,
    teamStatus: teamIds.flatMap((id) => {
      const t = d.teams.find((x) => x.id === id);
      return t ? [{ id, status: t.status }] : [];
    }),
    plan: openStagePlan(d),
  };
}

/**
 * Neuen Stand setzen: Teamstatus, Format, Einteilung der Vorrunde und alle offenen Spiele. Angepfiffene und
 * beendete Spiele bleiben („gespielt ist gespielt“). Gibt die IDs der offenen Spiele danach zurück.
 */
export function applyReshapeState(d: TournamentData, s: ReshapeState, newId: () => string, nowISO: string): string[] {
  assertFormat(d);
  const old = d.tournament.format!;
  const first = s.format.stages[0];
  if (!first || first.id !== old.stages[0]?.id) throw new Error('Die Vorrunde lässt sich beim Umstellen nicht austauschen.');
  for (const st of d.matches) {
    if (st.stageId && !isOpen(st) && !s.format.stages.some((x) => x.id === st.stageId)) {
      throw new Error('In einem Abschnitt, der wegfallen würde, wurde schon gespielt.');
    }
  }
  for (const { id, status } of s.teamStatus) {
    const t = d.teams.find((x) => x.id === id);
    if (!t) throw new Error('Unbekanntes Team.');
    if (t.status !== status) {
      t.status = status;
      t.withdrawnAt = status === 'active' ? undefined : nowISO;
    }
  }
  const drawn = (s.draw?.groups ?? d.groupDraws?.find((g) => g.stageId === first.id)?.groups ?? []).flat().length;
  const issue = validateFormat(s.format, drawn)[0];
  if (issue) throw new Error(issue.message);
  d.tournament.format = structuredClone(s.format);
  if (s.draw) applyGroupDraw(d, checkGroupDraw(d, s.draw), nowISO);
  return applyStagePlan(d, s.plan, newId, nowISO);
}

/** Für den Verlauf (Firestore kennt keine Listen in Listen: Gruppen als `{ teamIds }`). */
export function reshapeAuditRecord(s: ReshapeState): Record<string, unknown> {
  return {
    format: s.format,
    draw: s.draw ? { stageId: s.draw.stageId, groups: s.draw.groups.map((teamIds) => ({ teamIds })), mode: s.draw.mode } : null,
    teams: s.teamStatus,
    matches: s.plan,
  };
}

/** Gegenstück zu `reshapeAuditRecord`; null, wenn der Eintrag unvollständig ist. */
export function reshapeStateFromAudit(v: unknown): ReshapeState | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const format = r.format as TournamentFormat | undefined;
  if (!format || !Array.isArray(format.stages) || !Array.isArray(r.teams) || !Array.isArray(r.matches)) return null;
  const draw = r.draw && typeof r.draw === 'object' ? (r.draw as Record<string, unknown>) : null;
  return {
    format,
    draw: draw
      ? {
          stageId: String(draw.stageId),
          groups: (Array.isArray(draw.groups) ? draw.groups : []).map((g: unknown) =>
            Array.isArray((g as { teamIds?: unknown }).teamIds) ? [...((g as { teamIds: string[] }).teamIds)] : [],
          ),
          mode: (draw.mode as GroupDraw['mode']) ?? 'manual',
        }
      : null,
    teamStatus: r.teams as ReshapeState['teamStatus'],
    plan: r.matches as PlannedStageMatch[],
  };
}
