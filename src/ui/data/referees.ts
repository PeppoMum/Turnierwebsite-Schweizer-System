// Schiris: Prüfungen und Regeln, die beide Datenhaltungen (mockStore, firestoreStore) gemeinsam nutzen.
// Grundsatz: Schiri-Angaben ändern nie das Spiel. Erst „Übernehmen“ der Turnierleitung macht aus einer
// Meldung ein echtes Ergebnis, über die üblichen Wege (recordScore bzw. finishKnockoutMatch).
import type { Match } from '../../domain';
import { checkKnockoutResult, isKnockoutLike } from './stages';
import type { KnockoutResult, RefereeReport, Refereeing, TournamentData } from './types';

export const REFEREE_NAME_MAX = 40;

export function checkedRefereeName(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('Bitte gib deinen Namen ein.');
  if (n.length > REFEREE_NAME_MAX) throw new Error(`Der Name darf höchstens ${REFEREE_NAME_MAX} Zeichen haben.`);
  return n;
}

function matchOf(d: TournamentData, matchId: string): Match {
  const m = d.matches.find((x) => x.id === matchId);
  if (!m) throw new Error('Das Spiel wurde nicht gefunden.');
  return m;
}

/** Prüft eine Schiri-Meldung und gibt sie bereinigt zurück (ohne überflüssige Neunmeter-Felder). */
export function checkedReport(d: TournamentData, matchId: string, r: Omit<RefereeReport, 'atISO'>): Omit<RefereeReport, 'atISO'> {
  const m = matchOf(d, matchId);
  if (!m.teamAId || !m.teamBId) throw new Error('Die Teams für dieses Spiel stehen noch nicht fest.');
  if (m.status === 'not_played' || m.status === 'cancelled') throw new Error('Dieses Spiel findet nicht statt.');
  const whole = (n: number | undefined) => n !== undefined && Number.isInteger(n) && n >= 0 && n <= 99;
  if (!whole(r.goalsA) || !whole(r.goalsB)) throw new Error('Tore müssen ganze Zahlen ab 0 sein.');
  if (!isKnockoutLike(d, m)) return { refereeId: r.refereeId, goalsA: r.goalsA, goalsB: r.goalsB };
  const decidedBy = r.decidedBy ?? (r.goalsA === r.goalsB || m.penaltyOnly ? 'penalties' : 'regular');
  const result: KnockoutResult = { goalsA: r.goalsA, goalsB: r.goalsB, decidedBy, penaltiesA: r.penaltiesA, penaltiesB: r.penaltiesB };
  checkKnockoutResult(d, matchId, result);
  return decidedBy === 'penalties'
    ? { refereeId: r.refereeId, goalsA: r.goalsA, goalsB: r.goalsB, decidedBy, penaltiesA: r.penaltiesA, penaltiesB: r.penaltiesB }
    : { refereeId: r.refereeId, goalsA: r.goalsA, goalsB: r.goalsB, decidedBy };
}

/** Wie „Übernehmen“ das gemeldete Ergebnis einträgt. */
export type AcceptStep = { kind: 'score'; goalsA: number; goalsB: number } | { kind: 'knockout'; result: KnockoutResult };

export function acceptStep(d: TournamentData, matchId: string): AcceptStep {
  const report = d.refereeing?.find((x) => x.matchId === matchId)?.report;
  if (!report) throw new Error('Für dieses Spiel hat kein Schiri ein Ergebnis gemeldet.');
  const m = matchOf(d, matchId);
  if (m.status === 'not_played' || m.status === 'cancelled') throw new Error('Dieses Spiel findet nicht statt.');
  if (!isKnockoutLike(d, m)) return { kind: 'score', goalsA: report.goalsA, goalsB: report.goalsB };
  const result: KnockoutResult = {
    goalsA: report.goalsA,
    goalsB: report.goalsB,
    decidedBy: report.decidedBy ?? 'regular',
    ...(report.decidedBy === 'penalties' ? { penaltiesA: report.penaltiesA, penaltiesB: report.penaltiesB } : {}),
  };
  checkKnockoutResult(d, matchId, result);
  return { kind: 'knockout', result };
}

/** Spiele, die für Schiris eine Rolle spielen (keine Entwürfe, keine abgesagten). */
export function refereeMatches(d: TournamentData): Match[] {
  return d.matches.filter((m) => m.status !== 'draft' && m.status !== 'cancelled');
}

export type ReportState = 'open' | 'accepted' | 'differs';

/** Steht die Meldung schon so im Spiel (übernommen), weicht sie ab, oder wartet sie noch? */
export function reportState(m: Match, r: RefereeReport): ReportState {
  if (m.status !== 'completed') return m.status === 'not_played' || m.status === 'cancelled' ? 'differs' : 'open';
  const same =
    m.goalsA === r.goalsA &&
    m.goalsB === r.goalsB &&
    (r.decidedBy !== 'penalties' || (m.decidedBy === 'penalties' && m.penaltiesA === r.penaltiesA && m.penaltiesB === r.penaltiesB));
  return same ? 'accepted' : 'differs';
}

/** Spiele mit Schiri-Meldung, die noch auf die Turnierleitung warten. */
export function openReports(d: TournamentData): Array<{ match: Match; entry: Refereeing & { report: RefereeReport } }> {
  const out: Array<{ match: Match; entry: Refereeing & { report: RefereeReport } }> = [];
  for (const e of d.refereeing ?? []) {
    if (!e.report) continue;
    const m = d.matches.find((x) => x.id === e.matchId);
    if (m && reportState(m, e.report) === 'open') out.push({ match: m, entry: e as Refereeing & { report: RefereeReport } });
  }
  return out.sort((a, b) => (a.match.startISO ?? '').localeCompare(b.match.startISO ?? ''));
}

/** Ergebnis einer Meldung als kurzer Text, z. B. „2:1“ oder „1:1, 4:3 i. N.“. */
export function reportText(r: Pick<RefereeReport, 'goalsA' | 'goalsB' | 'decidedBy' | 'penaltiesA' | 'penaltiesB'>): string {
  const base = `${r.goalsA}:${r.goalsB}`;
  if (r.decidedBy === 'penalties') return `${base}, ${r.penaltiesA}:${r.penaltiesB} im Neunmeterschießen`;
  if (r.decidedBy === 'extra_time') return `${base} nach Verlängerung`;
  return base;
}
