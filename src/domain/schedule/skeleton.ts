// Vorschau beim Anlegen: aus Format und Teamzahl ein Spielgerüst bauen und durchplanen, damit der
// Baukasten Anzahl Spiele, Spiele pro Team und die Uhrzeit des letzten Spiels zeigen kann.
// Die echten Paarungen und K.-o.-Schlüssel kommen später aus der Gruppen- bzw. K.-o.-Logik;
// das Gerüst hat nur dieselbe Form (gleich viele Spiele, gleiche Reihenfolge-Abhängigkeiten).
import type { GroupStage, SlotRef, StageConfig, TournamentFormat } from '../format/types';
import { planTournamentDay, type DayPlan, type DayPlanConstraints, type StageMatchToPlan } from './stages';
import type { ScheduleField } from './types';

/** Gruppengrößen so gleichmäßig wie möglich: 18 Teams, 4 Gruppen = 5-5-4-4. */
export function evenGroupSizes(teamCount: number, groupCount: number): number[] {
  if (groupCount <= 0) return [];
  const base = Math.floor(teamCount / groupCount);
  return Array.from({ length: groupCount }, (_, g) => base + (g < teamCount % groupCount ? 1 : 0));
}

/** Jeder gegen jeden nach der Kreismethode: Spieltage mit Paaren aus Indizes. */
export function roundRobinRounds(teamCount: number, double = false): Array<Array<[number, number]>> {
  const ids: Array<number | null> = Array.from({ length: teamCount }, (_, i) => i);
  if (ids.length % 2 === 1) ids.push(null);
  const n = ids.length;
  const rounds: Array<Array<[number, number]>> = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i]!;
      const b = ids[n - 1 - i]!;
      if (a !== null && b !== null) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop()!);
  }
  return double ? [...rounds, ...rounds.map((ps) => ps.map(([a, b]) => [b, a] as [number, number]))] : rounds;
}

function groupSizesOf(stage: GroupStage, teamCount: number): number[] {
  return stage.groupSizes ?? evenGroupSizes(teamCount, stage.groupCount);
}

/** Wie viele Teams ein Abschnitt bekommt (erster Abschnitt: alle). */
function stageTeamCounts(format: TournamentFormat, teamCount: number): Map<string, number> {
  const counts = new Map<string, number>();
  const tables = new Map<string, number[]>(); // Tabellengrößen je Abschnitt
  for (const s of format.stages) {
    let n: number;
    if (s.kind === 'knockout') n = s.size;
    else if (s.kind === 'placement') n = s.matches.length * 2;
    else if (!s.entry) n = teamCount;
    else {
      const from = tables.get(s.entry.fromStageId) ?? [];
      n =
        from.reduce((sum, size) => sum + s.entry!.places.filter((p) => p <= size).length, 0) +
        (s.entry.best ?? []).reduce((sum, b) => sum + b.count, 0);
    }
    counts.set(s.id, n);
    tables.set(s.id, s.kind === 'groups' ? groupSizesOf(s, n) : [n]);
  }
  return counts;
}

const KO_NAMES: Record<number, (n: number) => string> = {
  2: () => 'F',
  4: (n) => `SF${n}`,
  8: (n) => `QF${n}`,
  16: (n) => `R16_${n}`,
  32: (n) => `R32_${n}`,
};

/** Gerüst eines Abschnitts. `seed` erzeugt Platzhalter für die Teams, die hineinkommen. */
function stageSkeleton(stage: StageConfig, n: number, seed: (i: number) => SlotRef): StageMatchToPlan[] {
  const out: StageMatchToPlan[] = [];
  const add = (m: Omit<StageMatchToPlan, 'id' | 'stageId'>) => out.push({ id: `${stage.id}#${out.length + 1}`, stageId: stage.id, ...m });

  if (stage.kind === 'groups' || stage.kind === 'final_group') {
    const sizes = stage.kind === 'groups' ? groupSizesOf(stage, n) : [n];
    let offset = 0;
    sizes.forEach((size, g) => {
      roundRobinRounds(size, stage.doubleRoundRobin).forEach((pairs, r) => {
        for (const [a, b] of pairs) add({ groupIndex: g, roundNumber: r + 1, slotA: seed(offset + a), slotB: seed(offset + b) });
      });
      offset += size;
    });
  } else if (stage.kind === 'placement') {
    for (const pm of stage.matches) add({ matchKey: pm.key, place: pm.place, slotA: pm.slotA, slotB: pm.slotB });
  } else if (stage.kind === 'knockout') {
    // Sieger spielen um die vorderen, Verlierer (bei allen Plätzen bzw. Platz 3) um die hinteren Plätze.
    const bracket = (slots: SlotRef[], fromPlace: number, prefix: string) => {
      const half = slots.length / 2;
      const key = (i: number) =>
        fromPlace === 1 ? KO_NAMES[slots.length]!(i + 1) : half === 1 ? `P${fromPlace}` : `${prefix}${slots.length}_${i + 1}`;
      const winners: SlotRef[] = [];
      const losers: SlotRef[] = [];
      for (let i = 0; i < half; i++) {
        const matchKey = key(i);
        add({ matchKey, place: half === 1 ? fromPlace : undefined, slotA: slots[2 * i]!, slotB: slots[2 * i + 1]! });
        winners.push({ kind: 'winner', stageId: stage.id, matchKey });
        losers.push({ kind: 'loser', stageId: stage.id, matchKey });
      }
      if (half > 1) bracket(winners, fromPlace, prefix);
      if (half > 1 && (stage.allPlaces || (stage.thirdPlace && fromPlace === 1 && slots.length === 4))) {
        bracket(losers, fromPlace + half, `P${fromPlace + half}_`);
      }
    };
    bracket(
      Array.from({ length: stage.size }, (_, i) => seed(i)),
      1,
      '',
    );
  }
  return out;
}

export interface FormatSkeleton {
  matches: StageMatchToPlan[];
  /** Teams je Abschnitt. */
  teamCounts: Map<string, number>;
}

/** Spielgerüst des ganzen Turniers für die Vorschau (Schweizer System bleibt außen vor). */
export function buildFormatSkeleton(format: TournamentFormat, teamCount: number): FormatSkeleton {
  const teamCounts = stageTeamCounts(format, teamCount);
  const matches = format.stages.flatMap((s) =>
    s.kind === 'swiss'
      ? []
      : stageSkeleton(s, teamCounts.get(s.id) ?? 0, (i) => (s.entry ? { kind: 'table_place', stageId: s.id, place: i + 1 } : { kind: 'team', teamId: `team${i + 1}` })),
  );
  return { matches, teamCounts };
}

/** Wenigste und meiste Spiele eines Teams innerhalb eines Abschnitts. */
function gamesInStage(stage: StageConfig, n: number): { min: number; max: number } {
  switch (stage.kind) {
    case 'groups': {
      const sizes = groupSizesOf(stage, n).filter((s) => s > 0);
      const f = stage.doubleRoundRobin ? 2 : 1;
      return { min: Math.min(...sizes) * f - f, max: Math.max(...sizes) * f - f };
    }
    case 'final_group':
      return { min: (n - 1) * (stage.doubleRoundRobin ? 2 : 1), max: (n - 1) * (stage.doubleRoundRobin ? 2 : 1) };
    case 'placement':
      return { min: 1, max: 1 };
    case 'knockout': {
      const rounds = Math.log2(stage.size);
      const min = stage.allPlaces ? rounds : stage.thirdPlace && stage.size === 4 ? 2 : 1;
      return { min, max: rounds };
    }
    case 'swiss':
      return { min: 0, max: 0 };
  }
}

export interface FormatPreview {
  matchCount: number;
  stages: Array<{ stageId: string; name: string; teamCount: number; matchCount: number; startISO?: string; endISO?: string }>;
  /** Spiele pro Team über das ganze Turnier, je nach Weg durch die Abschnitte. */
  gamesPerTeam: { min: number; max: number };
  firstStartISO?: string;
  lastEndISO?: string;
  warnings: string[];
  problems: string[];
  plan: DayPlan;
}

/** Zahlen für die Live-Skizze beim Anlegen: Spiele, Spiele pro Team, Uhrzeit des letzten Spiels. */
export function previewFormat(
  format: TournamentFormat,
  teamCount: number,
  fields: readonly ScheduleField[],
  constraints: DayPlanConstraints,
): FormatPreview {
  const skeleton = buildFormatSkeleton(format, teamCount);
  const plan = planTournamentDay(format, skeleton.matches, fields, constraints);

  // Spiele pro Team: je Phase das Minimum/Maximum der Abschnitte; wer in einer Phase keinen
  // Abschnitt bekommt, ist ausgeschieden und spielt dort 0.
  let min = 0;
  let max = 0;
  let previousTeams = teamCount;
  for (const phase of [...new Set(format.stages.map((s) => s.phase))].sort((a, b) => a - b)) {
    const stages = format.stages.filter((s) => s.phase === phase);
    const ranges = stages.map((s) => gamesInStage(s, skeleton.teamCounts.get(s.id) ?? 0));
    const teams = stages.reduce((sum, s) => sum + (skeleton.teamCounts.get(s.id) ?? 0), 0);
    min += teams < previousTeams ? 0 : Math.min(...ranges.map((r) => r.min));
    max += Math.max(...ranges.map((r) => r.max));
    previousTeams = teams;
  }

  return {
    matchCount: skeleton.matches.length,
    stages: format.stages.map((s) => {
      const span = plan.stages.find((x) => x.stageId === s.id);
      return {
        stageId: s.id,
        name: s.name,
        teamCount: skeleton.teamCounts.get(s.id) ?? 0,
        matchCount: skeleton.matches.filter((m) => m.stageId === s.id).length,
        ...(span ? { startISO: span.startISO, endISO: span.endISO } : {}),
      };
    }),
    gamesPerTeam: { min, max },
    firstStartISO: plan.phases[0]?.startISO,
    lastEndISO: plan.lastEndISO,
    warnings: plan.warnings,
    problems: plan.problems,
    plan,
  };
}
