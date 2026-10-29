// Einstiegsregeln: wer aus einem Abschnitt in den nächsten kommt (docs/turnier-baukasten.md, „Aufbau“).
//
// Eine Regel besteht aus festen Plätzen jeder Gruppe („1. und 2.“) und optional „die besten N eines
// Platzes“ über alle Gruppen hinweg. Verglichen wird dann nach Quotient: Punkte pro Spiel, danach
// Tordifferenz pro Spiel, danach Tore pro Spiel. Bleibt es gleich, entscheidet das Los der Turnierleitung.

import type { EntryRule, GroupTableRow, SlotRef, StageConfig, StageStandings, TournamentFormat } from '../format/types';

/** Gleichmäßige Gruppengrößen, größere Gruppen zuerst (18 Teams / 4 Gruppen = 5-5-4-4). */
export function evenGroupSizes(teamCount: number, groupCount: number): number[] {
  if (groupCount <= 0) return [];
  const base = Math.floor(teamCount / groupCount);
  const extra = teamCount % groupCount;
  return Array.from({ length: groupCount }, (_, g) => base + (g < extra ? 1 : 0));
}

/** Anzahl Tabellen eines Abschnitts (Gruppen; Liga, Schweizer System und Finalgruppe haben eine). */
export function tableCount(stage: StageConfig): number {
  if (stage.kind === 'groups') return stage.groupCount;
  if (stage.kind === 'swiss' || stage.kind === 'final_group') return 1;
  return 0;
}

/** Ob die Plätze eines Abschnitts als „n. Gruppe X“ (statt „n. Platz“) angesprochen werden. */
function hasGroups(stage: StageConfig): boolean {
  return stage.kind === 'groups';
}

/** Wie viele Teams aus einer Regel kommen, wenn der Quellabschnitt diese Tabellengrößen hat. */
export function entryCount(rule: EntryRule, sourceTableSizes: readonly number[]): number {
  const fixed = rule.places.reduce((n, p) => n + sourceTableSizes.filter((size) => size >= p).length, 0);
  const best = (rule.best ?? []).reduce((n, b) => n + b.count, 0);
  return fixed + best;
}

/**
 * Platzhalter einer Einstiegsregel in Setzreihenfolge: nach Platz, bei gleichem Platz erst die festen
 * Plätze (Gruppe A, B, …), dann die Besten dieses Platzes (bester zuerst). Gruppen, die einen Platz
 * nicht haben (5. in einer Vierergruppe), fallen weg.
 */
export function entrySlots(rule: EntryRule, source: StageConfig, sourceTableSizes: readonly number[]): SlotRef[] {
  const places = [...new Set([...rule.places, ...(rule.best ?? []).map((b) => b.place)])].sort((a, b) => a - b);
  const slots: SlotRef[] = [];
  for (const place of places) {
    if (rule.places.includes(place)) {
      sourceTableSizes.forEach((size, group) => {
        if (size < place) return;
        slots.push(
          hasGroups(source)
            ? { kind: 'group_place', stageId: source.id, group, place }
            : { kind: 'table_place', stageId: source.id, place },
        );
      });
    }
    for (const b of rule.best ?? []) {
      if (b.place !== place) continue;
      const first = b.fromRank ?? 1;
      for (let rank = first; rank < first + b.count; rank++) slots.push({ kind: 'best_of_place', stageId: source.id, place, rank });
    }
  }
  return slots;
}

/** Größer = besser. Vergleicht a/pa mit b/pb exakt; ohne Spiel zählt als 0. */
function compareRatio(a: number, pa: number, b: number, pb: number): number {
  const [an, ad] = pa === 0 ? [0, 1] : [a, pa];
  const [bn, bd] = pb === 0 ? [0, 1] : [b, pb];
  const l = an * bd;
  const r = bn * ad;
  return l === r ? 0 : l > r ? 1 : -1;
}

/**
 * Vergleich über Gruppen hinweg. Negativ, wenn `a` besser ist (für `Array.sort`).
 * Reihenfolge: Punkte pro Spiel, Tordifferenz pro Spiel, Tore pro Spiel.
 */
export function compareAcrossGroups(a: GroupTableRow, b: GroupTableRow): number {
  return (
    -compareRatio(a.points, a.played, b.points, b.played) ||
    -compareRatio(a.goalsFor - a.goalsAgainst, a.played, b.goalsFor - b.goalsAgainst, b.played) ||
    -compareRatio(a.goalsFor, a.played, b.goalsFor, b.played)
  );
}

export interface BestOfRanking {
  /** Bester zuerst. `group` ist die Gruppe, aus der das Team kommt. */
  rows: { row: GroupTableRow; group: number }[];
  /** Teams, die nach Quotient gleich sind und für deren Reihenfolge noch ein Los fehlt (je Gleichstand eine Liste). */
  needsLot: string[][];
}

/**
 * Rangliste aller Teams auf Gruppenplatz `place` über alle Gruppen. `lotOrder` ist die von der
 * Turnierleitung gezogene Reihenfolge (früher = besser). Fehlt ein Los, steht die frühere Gruppe vorn,
 * und der Gleichstand wird in `needsLot` gemeldet.
 */
export function rankBestOfPlace(standings: StageStandings, place: number, lotOrder: readonly string[] = []): BestOfRanking {
  const lotIndex = (id: string) => {
    const i = lotOrder.indexOf(id);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  const rows = standings.groups.flatMap((table, group) => {
    const row = table[place - 1];
    return row ? [{ row, group }] : [];
  });
  rows.sort((x, y) => compareAcrossGroups(x.row, y.row) || lotIndex(x.row.teamId) - lotIndex(y.row.teamId) || x.group - y.group);
  const needsLot: string[][] = [];
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && compareAcrossGroups(rows[i]!.row, rows[j]!.row) === 0) j++;
    const tied = rows.slice(i, j).map((r) => r.row.teamId);
    if (tied.length > 1 && tied.some((id) => lotIndex(id) === Number.POSITIVE_INFINITY)) needsLot.push(tied);
    i = j;
  }
  return { rows, needsLot };
}

/** Tabellengrößen aller Abschnitte, ausgehend von der Teamzahl des ersten Abschnitts. */
export function stageTableSizes(format: TournamentFormat, teamCount: number): Map<string, number[]> {
  const sizes = new Map<string, number[]>();
  for (const stage of format.stages) {
    let teams = teamCount;
    if (stage.entry) {
      const source = sizes.get(stage.entry.fromStageId);
      teams = source ? entryCount(stage.entry, source) : 0;
    }
    if (stage.kind === 'groups') {
      sizes.set(stage.id, stage.groupSizes?.length === stage.groupCount ? [...stage.groupSizes] : evenGroupSizes(teams, stage.groupCount));
    } else if (stage.kind === 'swiss' || stage.kind === 'final_group') {
      sizes.set(stage.id, [teams]);
    } else {
      sizes.set(stage.id, []);
    }
  }
  return sizes;
}

export type FormatIssueCode =
  | 'first_stage_entry'
  | 'missing_entry'
  | 'unknown_source'
  | 'source_not_table'
  | 'place_missing'
  | 'best_too_many'
  | 'count_mismatch'
  | 'slot_taken_twice'
  | 'range_size'
  | 'range_overlap'
  | 'group_sizes';

export interface FormatIssue {
  stageId: string;
  code: FormatIssueCode;
  /** Für die Turnierleitung, in Alltagssprache. */
  message: string;
}

function groupLetter(group: number): string {
  return String.fromCharCode(65 + group);
}

/** Wie viele Teams ein Abschnitt aufnimmt; `null` = beliebig viele (Gruppen, Finalgruppe). */
export function stageCapacity(stage: StageConfig): number | null {
  if (stage.kind === 'knockout') return stage.size;
  if (stage.kind === 'placement') return stage.matches.length * 2 + (stage.byes?.length ?? 0);
  return null;
}

/**
 * Prüfung beim Anlegen: Jede Regel ergibt genau so viele Teams, wie der Abschnitt braucht, kein Platz
 * wird von zwei Abschnitten derselben Runde beansprucht, und die Platzbereiche der Endplatzierung
 * überschneiden sich nicht.
 */
export function validateFormat(format: TournamentFormat, teamCount: number): FormatIssue[] {
  const issues: FormatIssue[] = [];
  const sizes = stageTableSizes(format, teamCount);
  const seen = new Map<string, StageConfig>();
  /** „Quelle|Platz|Gruppe“ bzw. „Quelle|best|Platz“ → Abschnitt, der den Platz nimmt. */
  const taken = new Map<string, StageConfig>();

  for (const stage of format.stages) {
    const add = (code: FormatIssueCode, message: string) => issues.push({ stageId: stage.id, code, message });
    const isFirst = seen.size === 0;
    if (stage.kind === 'groups' && stage.groupSizes && stage.groupSizes.length !== stage.groupCount) {
      add('group_sizes', `${stage.name}: Es sind ${stage.groupSizes.length} Gruppengrößen für ${stage.groupCount} Gruppen angegeben.`);
    }
    if (isFirst) {
      if (stage.entry) add('first_stage_entry', `${stage.name} ist der erste Abschnitt und bekommt alle Teams, braucht also keine Einstiegsregel.`);
      seen.set(stage.id, stage);
      continue;
    }
    seen.set(stage.id, stage);
    const rule = stage.entry;
    if (!rule) {
      add('missing_entry', `Für ${stage.name} ist nicht festgelegt, welche Teams hineinkommen.`);
      continue;
    }
    const source = format.stages.find((s) => s.id === rule.fromStageId);
    if (!source || !seen.has(source.id) || source.id === stage.id) {
      add('unknown_source', `${stage.name} soll Teams aus einem Abschnitt bekommen, der vorher nicht vorkommt.`);
      continue;
    }
    const tables = sizes.get(source.id) ?? [];
    if (tables.length === 0) {
      add('source_not_table', `${stage.name} kann Teams nur aus einem Abschnitt mit Tabelle bekommen, nicht aus ${source.name}.`);
      continue;
    }
    for (const place of rule.places) {
      if (!tables.some((size) => size >= place)) add('place_missing', `In ${source.name} gibt es keinen ${place}. Platz.`);
    }
    for (const b of rule.best ?? []) {
      const available = tables.filter((size) => size >= b.place).length - (rule.places.includes(b.place) ? tables.length : 0);
      const skipped = (b.fromRank ?? 1) - 1;
      if (b.count + skipped > available) {
        add('best_too_many', `${stage.name}: Es gibt nur ${Math.max(available, 0)} Teams auf Platz ${b.place}, nicht ${b.count + skipped}.`);
      }
    }
    const capacity = stageCapacity(stage);
    const count = entryCount(rule, tables);
    if (capacity !== null && count !== capacity) {
      add('count_mismatch', `${stage.name} braucht genau ${capacity} Teams, die Regel ergibt aber ${count}.`);
    }

    for (const place of rule.places) {
      const bestOwner = taken.get(`${source.id}|best|${place}`);
      if (bestOwner && bestOwner.phase === stage.phase && bestOwner !== stage) {
        add('slot_taken_twice', `Die besten Teams auf Platz ${place} gehen schon in ${bestOwner.name}, Platz ${place} kann also nicht zusätzlich fest in ${stage.name}.`);
      }
      tables.forEach((size, group) => {
        if (size < place) return;
        const key = `${source.id}|${place}|${group}`;
        const other = taken.get(key);
        if (other && other.phase === stage.phase) {
          const label = hasGroups(source) ? `${place}. Gruppe ${groupLetter(group)}` : `${place}. Platz`;
          add('slot_taken_twice', `${label} kommt in ${other.name} und in ${stage.name} vor.`);
        } else if (!other) taken.set(key, stage);
      });
    }
    for (const b of rule.best ?? []) {
      const key = `${source.id}|best|${b.place}`;
      const fixedOwner = [...taken.entries()].find(([k, s]) => k.startsWith(`${source.id}|${b.place}|`) && s.phase === stage.phase && s !== stage)?.[1];
      // Mehrere Abschnitte dürfen sich einen Platz teilen, solange sich die Ränge nicht überschneiden
      // (Gold die zwei besten Dritten, Silber ab dem drittbesten).
      const first = b.fromRank ?? 1;
      const other = Array.from({ length: b.count }, (_, i) => taken.get(`${key}|${first + i}`)).find((s) => s && s.phase === stage.phase);
      if (other) {
        add('slot_taken_twice', `Die besten Teams auf Platz ${b.place} kommen in ${other.name} und in ${stage.name} vor.`);
      } else if (fixedOwner) {
        add('slot_taken_twice', `Platz ${b.place} geht schon fest in ${fixedOwner.name}, kann also nicht zusätzlich in ${stage.name} verglichen werden.`);
      } else {
        if (!taken.has(key)) taken.set(key, stage);
        for (let i = 0; i < b.count; i++) taken.set(`${key}|${first + i}`, stage);
      }
    }

    if (stage.placeRange) {
      const rangeSize = stage.placeRange.to - stage.placeRange.from + 1;
      if (rangeSize !== count) {
        add('range_size', `${stage.name} spielt um die Plätze ${stage.placeRange.from} bis ${stage.placeRange.to}, hat aber ${count} Teams.`);
      }
    }
  }

  const ranged = format.stages.filter((s) => s.placeRange);
  for (let i = 0; i < ranged.length; i++) {
    for (let j = i + 1; j < ranged.length; j++) {
      const a = ranged[i]!;
      const b = ranged[j]!;
      if (a.placeRange!.from <= b.placeRange!.to && b.placeRange!.from <= a.placeRange!.to) {
        issues.push({ stageId: b.id, code: 'range_overlap', message: `${a.name} und ${b.name} spielen um dieselben Plätze.` });
      }
    }
  }
  return issues;
}
