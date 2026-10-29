// „Turnier umstellen“: aus den Vorschlägen der Fachlogik (src/domain/format/reshape.ts) fertige Spielpläne
// machen, mit Zahl der Spiele, neuer Endzeit und Hinweis auf Teams, die früher dran wären als geplant.
//
// Zeiten weich beibehalten: Bei „Lücke lassen“ und „Endrunde anpassen“ bleiben alle Spiele, die es weiter gibt,
// genau zu ihrer Zeit auf ihrem Feld; nur neue Spiele (Team hat die Gruppe gewechselt, geänderte Endrunde)
// werden in freie Zeiten gelegt. Bei neu zusammengesetzten Gruppen wird alles neu geplant.
import type { Match } from '../../../../domain';
import { adaptFinals, reshapeSuggestions, type ReshapeSuggestion, type ThreeTeamChoice, type TournamentFormat } from '../../../../domain/format';
import { addMinutes, planTournamentDay, type DayPlan, type StageMatchToPlan } from '../../../../domain/schedule';
import { isOpen } from '../../../data/stages';
import type { PlannedStageMatch, TournamentData } from '../../../data/types';
import { buildStageMatches } from '../../wizard/plan';

export interface ReshapeOption {
  suggestion: ReshapeSuggestion;
  /** Zum Speichern mit `reshapeTournament`: alle noch nicht angepfiffenen Baukasten-Spiele danach. */
  plan: PlannedStageMatch[];
  /** Alle Spiele des Turniers danach (auch schon gespielte). */
  matchCount: number;
  /** Spiele, die neu angesetzt oder verschoben werden. */
  movedCount: number;
  endISO?: string;
  /** Teams, die früher spielen würden als bisher geplant und noch nicht als „ist da“ abgehakt sind. */
  earlyTeamIds: string[];
  problems: string[];
}

const ms = (iso: string) => Date.parse(iso);

function firstStageId(data: TournamentData): string | undefined {
  return data.tournament.format?.stages[0]?.id;
}

/** Ob in der Vorrunde schon etwas angepfiffen wurde (dann bleiben die Gruppen). */
export function groupsStarted(data: TournamentData): boolean {
  const first = firstStageId(data);
  return data.matches.some((m) => m.stageId === first && !isOpen(m));
}

/** Jetzige Einteilung der Vorrunde. */
export function currentGroups(data: TournamentData): string[][] {
  const first = firstStageId(data);
  return data.groupDraws?.find((g) => g.stageId === first)?.groups.map((g) => [...g]) ?? [];
}

/** Teams, die schon fehlen (nicht erschienen oder zurückgezogen), aber noch in der Einteilung stehen. */
export function inactiveTeamIds(data: TournamentData): string[] {
  const inDraw = new Set(currentGroups(data).flat());
  return data.teams.filter((t) => t.status !== 'active' && inDraw.has(t.id)).map((t) => t.id);
}

const pairKey = (stageId: string, a?: string, b?: string) => `${stageId}|${[a ?? '', b ?? ''].sort().join('|')}`;

/** Erste geplante Anstoßzeit je Team. */
function firstStarts(list: ReadonlyArray<{ teamAId?: string; teamBId?: string; startISO?: string }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of list) {
    if (!m.startISO) continue;
    for (const t of [m.teamAId, m.teamBId]) {
      if (!t) continue;
      const v = ms(m.startISO);
      if (!out.has(t) || v < out.get(t)!) out.set(t, v);
    }
  }
  return out;
}

function isCheckedIn(team: TournamentData['teams'][number]): boolean {
  return !!(team as { checkedInAt?: string }).checkedInAt;
}

interface Planned {
  plan: PlannedStageMatch[];
  day: DayPlan;
  all: Array<{ teamAId?: string; teamBId?: string; startISO?: string; endISO?: string }>;
  matchCount: number;
  movedCount: number;
}

/** Spielplan für ein neues Format und eine neue Einteilung berechnen. */
function planFor(data: TournamentData, format: TournamentFormat, groups: string[][], redraw: boolean, changedStageIds: readonly string[]): Planned {
  const sched = data.tournament.schedule;
  const first = format.stages[0]!;
  const teamCount = groups.reduce((n, g) => n + g.length, 0);
  const built = buildStageMatches(format, teamCount, groups);
  const stageMatches = data.matches.filter((m) => m.stageId);
  const changed = new Set(changedStageIds);
  const durationOf = (stageId: string, own?: number) => own ?? format.stages.find((s) => s.id === stageId)?.matchMinutes ?? sched.matchMinutes;

  // Vorhandene Gruppenspiele nach Paarung, damit sie ihre ID, Zeit und ihr Feld behalten.
  const existingPair = new Map<string, Match>();
  for (const m of stageMatches) if (m.stageId === first.id && m.teamAId && m.teamBId) existingPair.set(pairKey(m.stageId, m.teamAId, m.teamBId), m);

  type Item = { toPlan: StageMatchToPlan; existing?: Match; built?: (typeof built)[number] };
  const items: Item[] = [];
  const used = new Set<string>();
  for (const b of built) {
    if (b.stageId !== first.id && !redraw && !changed.has(b.stageId)) continue;
    const existing = b.stageId === first.id ? existingPair.get(pairKey(b.stageId, b.teamAId, b.teamBId)) : undefined;
    const keep = !!existing && (!redraw || !isOpen(existing));
    if (existing) used.add(existing.id);
    items.push({
      existing,
      built: b,
      toPlan: {
        ...b,
        id: existing?.id ?? b.id,
        durationMinutes: existing?.durationMinutes ?? durationOf(b.stageId, b.durationMinutes),
        ...(existing ? { status: existing.status } : {}),
        ...(keep && existing?.startISO && existing.fieldId ? { manual: true, startISO: existing.startISO, fieldId: existing.fieldId } : {}),
      },
    });
  }
  // Unveränderte Endrunden bleiben, wie sie sind (auch mit eingetragenen Teams).
  if (!redraw) {
    for (const m of stageMatches) {
      if (m.stageId === first.id || changed.has(m.stageId!) || !format.stages.some((s) => s.id === m.stageId)) continue;
      used.add(m.id);
      items.push({
        existing: m,
        toPlan: {
          id: m.id,
          stageId: m.stageId!,
          groupIndex: m.groupIndex,
          matchKey: m.matchKey,
          teamAId: m.teamAId || undefined,
          teamBId: m.teamBId || undefined,
          slotA: m.slotA,
          slotB: m.slotB,
          status: m.status,
          durationMinutes: m.durationMinutes,
          ...(m.startISO && m.fieldId ? { manual: true, startISO: m.startISO, fieldId: m.fieldId } : {}),
        },
      });
    }
  }
  // Schon angepfiffene Spiele, die es im neuen Plan nicht gibt, belegen trotzdem ihr Feld.
  const extra: StageMatchToPlan[] = stageMatches
    .filter((m) => !used.has(m.id) && !isOpen(m) && m.status !== 'not_played' && m.startISO && m.fieldId && format.stages.some((s) => s.id === m.stageId))
    .map((m) => ({ id: m.id, stageId: m.stageId!, teamAId: m.teamAId, teamBId: m.teamBId, status: m.status, startISO: m.startISO, fieldId: m.fieldId, durationMinutes: m.durationMinutes }));

  const day = planTournamentDay(
    format,
    [...items.map((i) => i.toPlan), ...extra],
    data.fields.map((f) => ({ id: f.id, name: f.name, order: f.order, active: f.active })),
    {
      tournamentStartISO: sched.tournamentStartISO,
      matchMinutes: sched.matchMinutes,
      turnoverMinutes: sched.turnoverMinutes,
      roundBreakMinutes: sched.roundBreakMinutes,
      evenRest: sched.evenRest,
    },
  );
  const slot = new Map(day.matches.map((p) => [p.matchId, p]));
  const plan: PlannedStageMatch[] = [];
  const all: Planned['all'] = [];
  let movedCount = 0;
  for (const { toPlan, existing, built: b } of items) {
    const p = slot.get(toPlan.id);
    const startISO = p?.startISO ?? toPlan.startISO;
    all.push({ teamAId: toPlan.teamAId, teamBId: toPlan.teamBId, startISO, endISO: startISO ? addMinutes(startISO, toPlan.durationMinutes ?? sched.matchMinutes) : undefined });
    if (existing && !isOpen(existing)) continue;
    if (!existing || existing.startISO !== startISO || existing.fieldId !== (p?.fieldId ?? toPlan.fieldId)) movedCount++;
    const src = existing ?? b!;
    plan.push({
      ...(existing ? { id: existing.id } : {}),
      stageId: toPlan.stageId,
      ...(toPlan.groupIndex !== undefined ? { groupIndex: toPlan.groupIndex } : {}),
      ...(toPlan.matchKey ? { matchKey: toPlan.matchKey } : {}),
      ...(toPlan.teamAId ? { teamAId: toPlan.teamAId } : toPlan.slotA ? { slotA: toPlan.slotA } : {}),
      ...(toPlan.teamBId ? { teamBId: toPlan.teamBId } : toPlan.slotB ? { slotB: toPlan.slotB } : {}),
      ...(existing?.teamAId && existing.slotA ? { slotA: existing.slotA } : {}),
      ...(existing?.teamBId && existing.slotB ? { slotB: existing.slotB } : {}),
      ...(src.penaltyOnly ? { penaltyOnly: true } : {}),
      ...(p ? { fieldId: p.fieldId, startISO: p.startISO, waveIndex: p.waveIndex } : toPlan.startISO ? { fieldId: toPlan.fieldId, startISO: toPlan.startISO, waveIndex: existing?.waveIndex } : {}),
      durationMinutes: toPlan.durationMinutes ?? sched.matchMinutes,
      ...(existing?.manual ? { manual: true } : {}),
    });
  }
  for (const m of stageMatches) {
    if (!used.has(m.id) && !isOpen(m)) all.push({ teamAId: m.teamAId, teamBId: m.teamBId, startISO: m.startISO });
  }
  const matchCount = items.length + stageMatches.filter((m) => !used.has(m.id) && !isOpen(m)).length;
  return { plan, day, all, matchCount, movedCount };
}

/** Summe, um wie viele Minuten sich die erste Anstoßzeit der Teams verschiebt (kleiner = besser). */
function shiftScore(data: TournamentData, planned: Planned): number {
  const before = firstStarts(data.matches);
  const after = firstStarts(planned.all);
  let sum = 0;
  for (const [team, t] of after) {
    const old = before.get(team);
    if (old !== undefined) sum += Math.abs(t - old) / 60_000;
  }
  return sum;
}

/**
 * Fertige Vorschläge für die Turnierleitung. `missingTeamIds`: vor dem Anpfiff die Teams, die fehlen; danach
 * werden immer die schon zurückgezogenen genommen.
 */
export function reshapeOptions(
  data: TournamentData,
  missingTeamIds: readonly string[],
  choices: Readonly<Record<string, ThreeTeamChoice>> = {},
): ReshapeOption[] {
  const format = data.tournament.format;
  if (!format || format.stages[0]?.kind !== 'groups') return [];
  const started = groupsStarted(data);
  const groups = currentGroups(data);
  const missing = started ? inactiveTeamIds(data) : [...new Set([...missingTeamIds, ...inactiveTeamIds(data)])];
  const suggestions = reshapeSuggestions({
    format,
    groups,
    missingTeamIds: missing,
    groupsStarted: started,
    choices,
    pickGroups: (candidates) => {
      if (candidates.length < 2) return 0;
      const scores = candidates.map((c) => {
        const f = adaptFinals(format, c.map((g) => g.length), choices, groups.map((g) => g.length));
        return shiftScore(data, planFor(data, f.format, c, false, f.changedStageIds));
      });
      return scores.indexOf(Math.min(...scores));
    },
  });
  const before = firstStarts(data.matches);
  const teams = new Map(data.teams.map((t) => [t.id, t]));
  return suggestions.map((suggestion) => {
    const planned = planFor(data, suggestion.format, suggestion.groups, suggestion.redraw, suggestion.changedStageIds);
    const after = firstStarts(planned.all);
    const earlyTeamIds = [...after.entries()]
      .filter(([team, t]) => {
        const old = before.get(team);
        const tm = teams.get(team);
        return old !== undefined && t < old && tm !== undefined && !isCheckedIn(tm);
      })
      .map(([team]) => team);
    const ends = planned.all.flatMap((m) => (m.endISO ? [ms(m.endISO)] : []));
    return {
      suggestion,
      plan: planned.plan,
      matchCount: planned.matchCount,
      movedCount: planned.movedCount,
      endISO: ends.length > 0 ? new Date(Math.max(...ends)).toISOString() : planned.day.lastEndISO,
      earlyTeamIds,
      problems: planned.day.problems,
    };
  });
}

/** Jetzige Endzeit (letzter Abpfiff) zum Vergleich. */
export function currentEndISO(data: TournamentData): string | undefined {
  const ends = data.matches.filter((m) => m.stageId && m.startISO).map((m) => ms(m.startISO!) + m.durationMinutes * 60_000);
  return ends.length > 0 ? new Date(Math.max(...ends)).toISOString() : undefined;
}
