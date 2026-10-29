// „Rückgängig“ im Änderungsverlauf: welche Einträge sich zurücknehmen lassen und was dann passiert.
// Gemeinsam für mockStore und firestoreStore, damit beide dieselben Regeln und Meldungen haben.
//
// Grundsätze:
// - Rückgängig ist ein neuer Schritt, der den alten Stand wiederherstellt. Der ursprüngliche Eintrag
//   bleibt im Verlauf stehen (das Protokoll ist unveränderlich) und wird als „rückgängig gemacht“ markiert.
// - Nur die jeweils letzte Änderung an einer Sache (ein Spiel, der Status einer Mannschaft, …) lässt sich
//   zurücknehmen, und nur, solange sich die Sache seitdem nicht anders verändert hat.
// - Ausgeloste Runden bleiben, wie sie sind. Wer ein Ergebnis zurücknimmt, nachdem die nächste Runde schon
//   ausgelost ist, ändert damit nur die Tabelle (wie eine normale Ergebniskorrektur).
import type { Match, NotPlayedReason, Visibility } from '../../domain';
import { visibilityLabel } from '../format';
import { canChangeDate } from './details';
import { isOpen, layoutSnap, sameLayout, stageOf, type LayoutSnap } from './stages';
import type { GroupDraw, HistoryEntry, TournamentData } from './types';

export interface MatchTarget {
  status: Extract<Match['status'], 'scheduled' | 'live' | 'completed' | 'not_played'>;
  goalsA: number | null;
  goalsB: number | null;
  notPlayedReason: NotPlayedReason | null;
  /** Nur bei Baukasten-Spielen: wie das Spiel entschieden war. */
  decided?: { decidedBy: Match['decidedBy'] | null; penaltiesA: number | null; penaltiesB: number | null };
}

export interface DetailsPatch {
  title?: string;
  organizerName?: string;
  venue?: string | null;
  localDate?: string;
}

export type UndoPlan =
  | { kind: 'match'; matchId: string; target: MatchTarget }
  | { kind: 'team-restore'; teamId: string; reopenMatchIds: string[] }
  | { kind: 'team-withdraw'; teamId: string }
  | { kind: 'team-rename'; teamId: string; name: string }
  | { kind: 'details'; patch: DetailsPatch }
  | { kind: 'visibility'; visibility: Visibility }
  | { kind: 'shift'; deltaMinutes: number }
  | { kind: 'round-reopen'; roundId: string }
  | { kind: 'tournament-reopen' }
  /** Ort, Zeit oder Gegner mehrerer Spiele zurück auf `target`; `reopen`: kampflos gewertete Spiele wieder öffnen. */
  | { kind: 'layout'; target: LayoutSnap[]; current: LayoutSnap[]; reopen: boolean }
  | { kind: 'group-draw'; draw: Omit<GroupDraw, 'updatedAt'> }
  | { kind: 'team-present'; teamId: string; present: boolean };

export type UndoCheck =
  | { ok: true; plan: UndoPlan; explain: string; warning?: string }
  | { ok: false; reason: string };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

const MATCH_ACTIONS = new Set([
  'match.live',
  'match.result.live',
  'match.result.final',
  'match.not_played',
  'match.reopen',
  'match.reset',
  'match.undo',
]);
const LAYOUT_ACTIONS = new Set([
  'match.swap',
  'match.swap_teams',
  'match.move',
  'finals.fill',
  'team.withdraw_qualified',
  'matches.undo',
  'schedule.compact',
  'schedule.longer',
]);
const DETAIL_KEYS = ['title', 'organizerName', 'venue', 'localDate'] as const;
const TARGET_STATUSES = new Set(['scheduled', 'live', 'completed', 'not_played']);

const CHANGED_SINCE = 'Das wurde danach noch einmal geändert. Nur die letzte Änderung lässt sich zurücknehmen.';

/** Worauf sich ein Eintrag bezieht; je Sache lässt sich nur der neueste Eintrag zurücknehmen. */
function subjectOf(e: HistoryEntry): string | null {
  const after = rec(e.after);
  if (MATCH_ACTIONS.has(e.action)) return `match:${e.targetId}`;
  if (LAYOUT_ACTIONS.has(e.action)) {
    const ids = snapsOf(after.matches).map((x) => x.id).sort();
    return ids.length > 0 ? `layout:${ids.join(',')}` : null;
  }
  if (e.action === 'groups.draw') return `groups:${e.targetId}`;
  if (e.action === 'team.withdrawn' || e.action === 'team.no_show' || e.action === 'team.restore') {
    return `team-status:${str(after.teamId) ?? ''}`;
  }
  if (e.action === 'team.update' || e.action === 'team.add') return `team-name:${e.targetId}`;
  if (e.action === 'team.present') return `team-present:${e.targetId}`;
  if (e.action === 'tournament.update') {
    return DETAIL_KEYS.some((k) => k in after) ? 'details' : null;
  }
  if (e.action === 'tournament.visibility') return 'visibility';
  if (e.action === 'schedule.shift') return 'shift';
  if (e.action === 'round.close' || e.action === 'round.reopen') return `round:${e.targetId}`;
  if (e.action.startsWith('tournament.status.')) return 'status';
  return null;
}

function snapsOf(v: unknown): LayoutSnap[] {
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is LayoutSnap => !!x && typeof x === 'object' && typeof (x as Rec).id === 'string') : [];
}

export function teamNameOf(data: TournamentData, id: unknown): string {
  return data.teams.find((x) => x.id === id)?.name ?? 'ein Team';
}

export function matchLabelOf(data: TournamentData, id: string): string {
  const m = data.matches.find((x) => x.id === id);
  if (!m) return 'Ein Spiel';
  const team = (tid: string) => (tid ? teamNameOf(data, tid) : 'noch offen');
  const stage = stageOf(data, m.stageId);
  if (stage) {
    const group = m.groupIndex !== undefined && stage.kind === 'groups' ? ` Gruppe ${String.fromCharCode(65 + m.groupIndex)}` : '';
    return `${team(m.teamAId)} – ${team(m.teamBId)} (${stage.name}${group})`;
  }
  return `${team(m.teamAId)} – ${team(m.teamBId)} (Runde ${m.roundNumber})`;
}

/** Spielstand in Worten, z. B. „beendet mit 2:1“. */
export function matchStateText(s: { status?: unknown; goalsA?: unknown; goalsB?: unknown }): string {
  const a = num(s.goalsA);
  const b = num(s.goalsB);
  const score = a !== null && b !== null ? `${a}:${b}` : null;
  switch (s.status) {
    case 'scheduled':
      return 'geplant, noch nicht angepfiffen';
    case 'live':
      return score ? `läuft, Stand ${score}` : 'läuft';
    case 'completed':
      return `beendet mit ${score ?? '?'}`;
    case 'not_played':
      return 'nicht ausgetragen';
    default:
      return 'unbekannt';
  }
}

function list(numbers: number[]): string {
  return numbers.length === 1 ? `Runde ${numbers[0]}` : `Die Runden ${numbers.slice(0, -1).join(', ')} und ${numbers.at(-1)}`;
}

/** Runden, die nach dem Eintrag ausgelost wurden (Zeitpunkt der Freigabe). */
function roundsDrawnAfter(data: TournamentData, atISO: string): number[] {
  if (!atISO) return [];
  return data.rounds
    .filter((r) => r.status !== 'draft' && r.status !== 'preview' && r.publishedAt && r.publishedAt > atISO)
    .map((r) => r.number)
    .sort((a, b) => a - b);
}

function checkMatch(e: HistoryEntry, data: TournamentData): UndoCheck | null {
  const before = rec(e.before);
  const after = rec(e.after);
  const status = str(before.status);
  if (!status || !TARGET_STATUSES.has(status)) return null;
  const m = data.matches.find((x) => x.id === e.targetId);
  if (!m) return { ok: false, reason: 'Das Spiel gibt es nicht mehr.' };

  const unchanged =
    (num(after.revision) !== null && num(after.revision) === m.revision) ||
    (m.status === after.status && (m.goalsA ?? null) === num(after.goalsA) && (m.goalsB ?? null) === num(after.goalsB));
  if (!unchanged) return { ok: false, reason: CHANGED_SINCE };

  const target: MatchTarget = {
    status: status as MatchTarget['status'],
    goalsA: status === 'completed' || status === 'live' ? num(before.goalsA) : null,
    goalsB: status === 'completed' || status === 'live' ? num(before.goalsB) : null,
    notPlayedReason: status === 'not_played' ? ((str(before.notPlayedReason) as NotPlayedReason | undefined) ?? 'other') : null,
    ...('decidedBy' in before
      ? { decided: { decidedBy: (str(before.decidedBy) as Match['decidedBy']) ?? null, penaltiesA: num(before.penaltiesA), penaltiesB: num(before.penaltiesB) } }
      : {}),
  };
  if (target.status === 'completed' && (target.goalsA === null || target.goalsB === null)) return null;
  const sameDecision =
    !target.decided ||
    (target.decided.decidedBy === (m.decidedBy ?? null) &&
      target.decided.penaltiesA === (m.penaltiesA ?? null) &&
      target.decided.penaltiesB === (m.penaltiesB ?? null));
  if (target.status === m.status && target.goalsA === (m.goalsA ?? null) && target.goalsB === (m.goalsB ?? null) && sameDecision) {
    return null;
  }

  const open = target.status === 'scheduled' || target.status === 'live';
  const round = data.rounds.find((r) => r.id === m.roundId);
  if (open && round?.status === 'closed') {
    return { ok: false, reason: `Runde ${m.roundNumber} ist schon abgeschlossen, dort kann kein Spiel mehr offen sein.` };
  }
  const out = [m.teamAId, m.teamBId].find((id) => data.teams.find((t) => t.id === id)?.status !== 'active');
  if (open && out) return { ok: false, reason: `${teamNameOf(data, out)} ist abgemeldet.` };

  const resultChanges =
    (target.status === 'completed') !== (m.status === 'completed') ||
    target.goalsA !== (m.goalsA ?? null) ||
    target.goalsB !== (m.goalsB ?? null);
  const later = data.rounds
    .filter((r) => r.number > m.roundNumber && r.status !== 'draft' && r.status !== 'preview')
    .map((r) => r.number)
    .sort((a, b) => a - b);
  return {
    ok: true,
    plan: { kind: 'match', matchId: m.id, target },
    explain: `Das Spiel ${matchLabelOf(data, m.id)} steht danach wieder auf „${matchStateText(target)}“.`,
    warning:
      resultChanges && later.length > 0
        ? `${list(later)} ${later.length === 1 ? 'ist' : 'sind'} schon ausgelost. Diese Paarungen bleiben, wie sie sind; es ändert sich nur die Tabelle.`
        : undefined,
  };
}

function checkLayout(e: HistoryEntry, data: TournamentData): UndoCheck | null {
  const target = snapsOf(rec(e.before).matches);
  const expected = snapsOf(rec(e.after).matches);
  if (target.length === 0 || target.length !== expected.length) return null;
  const reopen = e.action === 'team.withdraw_qualified' && rec(e.after).choice === 'walkover';
  const current: LayoutSnap[] = [];
  for (const s of expected) {
    const m = data.matches.find((x) => x.id === s.id);
    if (!m) return { ok: false, reason: 'Das Spiel gibt es nicht mehr.' };
    const walkover = reopen && m.status === 'not_played' && m.decidedBy === 'walkover';
    if (!isOpen(m) && !walkover) return { ok: false, reason: 'Das Spiel ist schon angepfiffen oder vorbei.' };
    const now = layoutSnap(m);
    if (!sameLayout(now, s)) return { ok: false, reason: CHANGED_SINCE };
    current.push(now);
  }
  const what =
    e.action === 'finals.fill'
      ? 'Die eingetragenen Teams werden wieder entfernt, die Plätze sind danach wieder offen.'
      : e.action === 'team.withdraw_qualified'
        ? reopen
          ? 'Die kampflos gewerteten Spiele sind danach wieder offen. Der Rückzug selbst bleibt; den nimmst du über seinen eigenen Eintrag zurück.'
          : 'Das zurückgezogene Team steht danach wieder in seinen Spielen. Der Rückzug selbst bleibt; den nimmst du über seinen eigenen Eintrag zurück.'
        : e.action === 'schedule.longer'
          ? 'Die Spiele dauern danach wieder so lange wie vorher.'
          : e.action === 'schedule.compact'
            ? 'Die nach vorne gezogenen Spiele stehen danach wieder an ihrer alten Zeit.'
            : 'Uhrzeit, Feld und Gegner stehen danach wieder wie vorher.';
  return { ok: true, plan: { kind: 'layout', target, current, reopen }, explain: what };
}

/** Gruppen aus dem Verlauf: dort als `{ teamIds }` gespeichert, weil Firestore keine Listen in Listen kennt. */
export function teamIdGroups(v: unknown): string[][] | null {
  if (!Array.isArray(v)) return null;
  return v.map((g) => (Array.isArray(g) ? g : Array.isArray(rec(g).teamIds) ? (rec(g).teamIds as unknown[]) : []).filter((x): x is string => typeof x === 'string'));
}

function checkGroupDraw(e: HistoryEntry, data: TournamentData): UndoCheck | null {
  const before = rec(e.before);
  const groups = teamIdGroups(before.groups);
  if (!groups) return null;
  const now = data.groupDraws?.find((g) => g.stageId === e.targetId);
  if (!now || JSON.stringify(now.groups) !== JSON.stringify(teamIdGroups(rec(e.after).groups))) return { ok: false, reason: CHANGED_SINCE };
  if (data.matches.some((m) => m.stageId === e.targetId && !isOpen(m))) {
    return { ok: false, reason: 'In diesem Abschnitt wurde schon gespielt. Die Gruppen bleiben, wie sie sind.' };
  }
  return {
    ok: true,
    plan: {
      kind: 'group-draw',
      draw: {
        stageId: e.targetId,
        groups,
        mode: (str(before.mode) as GroupDraw['mode'] | undefined) ?? 'manual',
        ...(Array.isArray(before.pots) ? { pots: teamIdGroups(before.pots)! } : {}),
      },
    },
    explain: 'Die Gruppen sind danach wieder so eingeteilt wie vorher.',
    warning: 'Den Spielplan danach bitte neu berechnen, damit die Spiele zur Einteilung passen.',
  };
}

function checkTeamStatus(e: HistoryEntry, data: TournamentData): UndoCheck | null {
  const after = rec(e.after);
  const team = data.teams.find((t) => t.id === after.teamId);
  if (!team) return { ok: false, reason: 'Die Mannschaft gibt es nicht mehr.' };

  if (e.action === 'team.restore') {
    if (team.status !== 'active') return { ok: false, reason: CHANGED_SINCE };
    return {
      ok: true,
      plan: { kind: 'team-withdraw', teamId: team.id },
      explain: `${team.name} wird wieder abgemeldet. Noch geplante Spiele von ${team.name} fallen aus.`,
    };
  }

  if (team.status !== after.status) return { ok: false, reason: CHANGED_SINCE };
  // Spiele, die der Rückzug ausfallen ließ: aus dem Eintrag, bei älteren Einträgen geschätzt.
  const recorded = Array.isArray(after.matchIds) ? (after.matchIds as unknown[]).filter((x): x is string => typeof x === 'string') : null;
  const closed = new Set(data.rounds.filter((r) => r.status === 'closed').map((r) => r.id));
  const reopen = data.matches
    .filter((m) =>
      recorded
        ? recorded.includes(m.id)
        : (m.teamAId === team.id || m.teamBId === team.id) &&
          (m.notPlayedReason === 'withdrawal' || m.notPlayedReason === 'no_show'),
    )
    .filter((m) => m.status === 'not_played' && !closed.has(m.roundId))
    .map((m) => m.id);
  const drawn = roundsDrawnAfter(data, e.atISO);
  return {
    ok: true,
    plan: { kind: 'team-restore', teamId: team.id, reopenMatchIds: reopen },
    explain:
      `${team.name} spielt wieder mit.` +
      (reopen.length === 1
        ? ' Das ausgefallene Spiel wird wieder geplant.'
        : reopen.length > 1
          ? ` Die ${reopen.length} ausgefallenen Spiele werden wieder geplant.`
          : ''),
    warning:
      drawn.length > 0
        ? `${list(drawn)} wurde${drawn.length === 1 ? '' : 'n'} ohne ${team.name} ausgelost und bleib${drawn.length === 1 ? 't' : 'en'} so. Ab der nächsten Runde wird ${team.name} wieder gepaart.`
        : undefined,
  };
}

function checkDetails(e: HistoryEntry, data: TournamentData): UndoCheck | null {
  const before = rec(e.before);
  const after = rec(e.after);
  const t = data.tournament;
  const current: Record<(typeof DETAIL_KEYS)[number], unknown> = {
    title: t.title,
    organizerName: t.organizerName,
    venue: t.venue ?? null,
    localDate: t.localDate,
  };
  const keys = DETAIL_KEYS.filter((k) => k in after && k in before && (before[k] ?? null) !== (after[k] ?? null));
  if (keys.length === 0) return null;
  if (keys.some((k) => (current[k] ?? null) !== (after[k] ?? null))) return { ok: false, reason: CHANGED_SINCE };

  const dateLocked = keys.includes('localDate') && !canChangeDate(data);
  const undo = keys.filter((k) => !(k === 'localDate' && dateLocked));
  if (undo.length === 0) {
    return { ok: false, reason: 'Das Datum lässt sich nicht mehr ändern, weil schon Runden ausgelost sind.' };
  }
  const patch: DetailsPatch = {};
  const parts: string[] = [];
  for (const k of undo) {
    const v = before[k];
    if (k === 'venue') {
      patch.venue = str(v) ?? null;
      parts.push(patch.venue ? `Ort „${patch.venue}“` : 'kein Ort');
    } else if (k === 'localDate') {
      patch.localDate = str(v) ?? t.localDate;
      parts.push(`Datum ${patch.localDate.split('-').reverse().join('.')}`);
    } else {
      patch[k] = str(v) ?? '';
      parts.push(`${k === 'title' ? 'Name' : 'Veranstalter'} „${patch[k]}“`);
    }
  }
  const logos = 'organizerAssetId' in after || 'eventAssetId' in after;
  return {
    ok: true,
    plan: { kind: 'details', patch },
    explain: `Danach wieder: ${parts.join(', ')}.${logos ? ' Logos und Sponsoren bleiben, wie sie jetzt sind.' : ''}`,
    warning: dateLocked ? 'Das Datum bleibt, weil schon Runden ausgelost sind.' : undefined,
  };
}

function checkRoundClose(e: HistoryEntry, data: TournamentData): UndoCheck | null {
  const round = data.rounds.find((r) => r.id === e.targetId);
  if (!round) return null;
  if (round.status !== 'closed') return { ok: false, reason: CHANGED_SINCE };
  const later = data.rounds.some((r) => r.number > round.number && r.status !== 'draft' && r.status !== 'preview');
  if (later) return { ok: false, reason: 'Danach wurde schon die nächste Runde ausgelost.' };
  if (data.tournament.status === 'finished') {
    return { ok: false, reason: 'Das Turnier ist beendet. Nimm zuerst „Turnier beendet“ zurück.' };
  }
  return {
    ok: true,
    plan: { kind: 'round-reopen', roundId: round.id },
    explain: `Runde ${round.number} ist danach wieder offen. Die nächste Runde kannst du erst auslosen, wenn du sie wieder abschließt.`,
  };
}

/**
 * Lässt sich der Eintrag zurücknehmen? null = Eintragsart ohne Rückgängig (z. B. Turnier angelegt).
 * `newest` = jüngster Eintrag zu seiner Sache (siehe `undoChecks`).
 */
export function undoCheck(e: HistoryEntry, data: TournamentData, newest = true): UndoCheck | null {
  const t = data.tournament;
  if (e.action === 'round.publish') {
    return { ok: false, reason: 'Ausgeloste Runden bleiben, weil die Paarungen schon öffentlich sind.' };
  }
  if (e.action === 'team.add') return { ok: false, reason: 'Nachgemeldete Mannschaften lassen sich unter „Teams“ abmelden.' };
  if (!subjectOf(e) || e.action === 'round.reopen') return null;
  if (t.status === 'archived') return { ok: false, reason: 'Das Turnier ist archiviert.' };
  if (!newest) return { ok: false, reason: CHANGED_SINCE };

  const before = rec(e.before);
  const after = rec(e.after);
  switch (e.action) {
    case 'team.withdrawn':
    case 'team.no_show':
    case 'team.restore':
      return checkTeamStatus(e, data);
    case 'team.update': {
      const old = str(before.name);
      const team = data.teams.find((x) => x.id === e.targetId);
      if (!old || old === after.name || !team) return null;
      if (team.name !== after.name) return { ok: false, reason: CHANGED_SINCE };
      return {
        ok: true,
        plan: { kind: 'team-rename', teamId: team.id, name: old },
        explain: `Die Mannschaft heißt danach wieder „${old}“.`,
      };
    }
    case 'team.present': {
      const team = data.teams.find((x) => x.id === e.targetId);
      if (!team || typeof after.present !== 'boolean') return null;
      if (Boolean(team.checkedInAt) !== after.present) return { ok: false, reason: CHANGED_SINCE };
      return {
        ok: true,
        plan: { kind: 'team-present', teamId: team.id, present: !after.present },
        explain: after.present ? `Bei ${team.name} ist „ist da“ danach nicht mehr abgehakt.` : `${team.name} ist danach wieder als „ist da“ abgehakt.`,
      };
    }
    case 'tournament.update':
      return checkDetails(e, data);
    case 'tournament.visibility': {
      const old = str(before.visibility) as Visibility | undefined;
      if (!old || old === after.visibility) return null;
      if (t.visibility !== after.visibility) return { ok: false, reason: CHANGED_SINCE };
      return {
        ok: true,
        plan: { kind: 'visibility', visibility: old },
        explain: `Zuschauer sehen danach wieder: ${visibilityLabel[old]}.`,
      };
    }
    case 'schedule.shift': {
      const d = num(after.deltaMinutes);
      if (!d) return null;
      if (roundsDrawnAfter(data, e.atISO).length > 0) {
        return { ok: false, reason: 'Danach wurde schon eine neue Runde ausgelost. Verschiebe den Zeitplan bitte im Live-Bereich.' };
      }
      return {
        ok: true,
        plan: { kind: 'shift', deltaMinutes: -d },
        explain: `Alle noch nicht angepfiffenen Spiele rücken wieder ${Math.abs(d)} Min. nach ${d > 0 ? 'vorne' : 'hinten'}.`,
      };
    }
    case 'round.close':
      return checkRoundClose(e, data);
    case 'groups.draw':
      return checkGroupDraw(e, data);
    case 'tournament.status.finished':
      if (t.status !== 'finished') return { ok: false, reason: CHANGED_SINCE };
      return {
        ok: true,
        plan: { kind: 'tournament-reopen' },
        explain: 'Das Turnier läuft danach wieder. Abgeschlossene Runden bleiben abgeschlossen.',
      };
    default:
      if (LAYOUT_ACTIONS.has(e.action)) return checkLayout(e, data);
      return MATCH_ACTIONS.has(e.action) ? checkMatch(e, data) : null;
  }
}

/** Prüft alle Einträge (neueste zuerst) und liefert je Eintrag, ob und wie er sich zurücknehmen lässt. */
export function undoChecks(entries: HistoryEntry[], data: TournamentData): Map<string, UndoCheck> {
  const seen = new Set<string>();
  const out = new Map<string, UndoCheck>();
  for (const e of entries) {
    const subject = subjectOf(e);
    const newest = subject === null || !seen.has(subject);
    if (subject) seen.add(subject);
    const check = undoCheck(e, data, newest);
    if (check) out.set(e.id, check);
  }
  return out;
}

/** IDs der Einträge, die schon rückgängig gemacht wurden. */
export function undoneIds(entries: HistoryEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    const of = str(rec(e.after).undoOf);
    if (of) ids.add(of);
  }
  return ids;
}
