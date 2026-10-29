// Turnier-Baukasten: den ganzen Turniertag über alle Abschnitte planen (docs/turnier-baukasten.md).
// Abschnitte mit gleicher `phase` laufen nebeneinander auf den Feldern, die nächste Phase beginnt
// erst, wenn die vorige vorbei ist (Gruppenplätze und „beste Dritte“ stehen erst dann fest).
// Spiele mit Platzhaltern bekommen schon Zeit und Feld. Das Schweizer System plant weiter
// Runde für Runde mit `createWaveSchedule`.
import type { SlotRef, StageConfig, TournamentFormat } from '../format/types';
import type { MatchStatus } from '../types';
import { addMinutes } from './time';
import type { ScheduleConstraints, ScheduleField } from './types';

/** Ein Spiel eines Abschnitts, wie es die Gruppen- bzw. K.-o.-Logik erzeugt. */
export interface StageMatchToPlan {
  id: string;
  stageId: string;
  groupIndex?: number;
  /** Spieltag in der Gruppe bzw. Tabelle (1-basiert); bestimmt die Reihenfolge. */
  roundNumber?: number;
  /** Schlüssel im K.-o.-Baum (`QF1`, `SF2`, `F`, `P3` …); Sieger-/Verlierer-Verweise zeigen darauf. */
  matchKey?: string;
  teamAId?: string;
  teamBId?: string;
  slotA?: SlotRef;
  slotB?: SlotRef;
  /** Ausgespielter Platz (Finale 1, Spiel um Platz 3 = 3); höhere Plätze kommen früher dran. */
  place?: number;
  status?: MatchStatus;
  /** Von Hand gesetzte Zeit/Feld: bleibt bei einer Neuberechnung, wo sie ist. */
  manual?: boolean;
  fieldId?: string;
  startISO?: string;
  durationMinutes?: number;
}

export type DayPlanConstraints = Pick<
  ScheduleConstraints,
  'tournamentStartISO' | 'matchMinutes' | 'turnoverMinutes' | 'roundBreakMinutes' | 'evenRest' | 'desiredRestMinutes'
>;

export interface PlannedStageMatch {
  matchId: string;
  stageId: string;
  phase: number;
  fieldId: string;
  fieldName: string;
  startISO: string;
  endISO: string;
  /** Laufende Nummer der Anstoßzeit über den ganzen Tag; -1 bei übernommenen Spielen. */
  waveIndex: number;
  /** Zeit und Feld wurden übernommen (Handänderung oder Spiel schon angepfiffen/vorbei). */
  kept: boolean;
}

export interface TimeSpan {
  startISO: string;
  endISO: string;
}

export interface DayRestWarning {
  /** Team-ID oder Platzhalter-Schlüssel (siehe `slotKey`). */
  participant: string;
  matchId: string;
  restMinutes: number;
  targetMinutes: number;
  message: string;
}

export interface DayPlan {
  matches: PlannedStageMatch[];
  stages: Array<TimeSpan & { stageId: string }>;
  phases: Array<TimeSpan & { phase: number }>;
  restWarnings: DayRestWarning[];
  warnings: string[];
  /** Blockierende Probleme (Plan so nicht veröffentlichen). */
  problems: string[];
  /** Abpfiff des letzten Spiels. */
  lastEndISO?: string;
}

export interface PlanDayOptions {
  teamNames?: ReadonlyMap<string, string>;
}

/** Spiele in diesem Zustand behalten Zeit und Feld; nur `draft`/`scheduled` werden geplant. */
export const EDITABLE_STATUSES: ReadonlySet<MatchStatus> = new Set(['draft', 'scheduled']);

const MS = 60_000;
const ms = (iso: string) => Date.parse(iso);

/** Eindeutiger Schlüssel für einen Platzhalter, z. B. für Pausen und Kollisionen vor dem Füllen. */
export function slotKey(slot: SlotRef): string {
  switch (slot.kind) {
    case 'group_place':
      return `gp:${slot.stageId}:${slot.group}:${slot.place}`;
    case 'best_of_place':
      return `bp:${slot.stageId}:${slot.place}:${slot.rank}`;
    case 'table_place':
      return `tp:${slot.stageId}:${slot.place}`;
    case 'winner':
    case 'loser':
      return `${slot.kind === 'winner' ? 'w' : 'l'}:${slot.stageId}:${slot.matchKey}`;
    case 'team':
      return slot.teamId;
  }
}

const PLACE_WORDS = ['Erster', 'Zweiter', 'Dritter', 'Vierter', 'Fünfter', 'Sechster', 'Siebter', 'Achter'];
const RANK_WORDS = ['bester', 'zweitbester', 'drittbester', 'viertbester', 'fünftbester', 'sechstbester'];

/** Kurzer Anzeigetext für Hinweise: „2. Gruppe B“, „zweitbester Dritter“, „Sieger QF1“. */
export function slotLabel(slot: SlotRef, teamNames?: ReadonlyMap<string, string>): string {
  switch (slot.kind) {
    case 'group_place':
      return `${slot.place}. Gruppe ${String.fromCharCode(65 + slot.group)}`;
    case 'best_of_place':
      return `${RANK_WORDS[slot.rank - 1] ?? `${slot.rank}.-bester`} ${PLACE_WORDS[slot.place - 1] ?? `${slot.place}.`}`;
    case 'table_place':
      return `${slot.place}. Platz`;
    case 'winner':
      return `Sieger ${slot.matchKey}`;
    case 'loser':
      return `Verlierer ${slot.matchKey}`;
    case 'team':
      return teamNames?.get(slot.teamId) ?? slot.teamId;
  }
}

/** Wer auf Seite A bzw. B spielt: Team, sonst Platzhalter, sonst ein eindeutiger Ersatz. */
export function sideKeys(m: Pick<StageMatchToPlan, 'id' | 'teamAId' | 'teamBId' | 'slotA' | 'slotB'>): [string, string] {
  return [
    m.teamAId ?? (m.slotA ? slotKey(m.slotA) : `${m.id}:A`),
    m.teamBId ?? (m.slotB ? slotKey(m.slotB) : `${m.id}:B`),
  ];
}

/** Anzeigename einer Spielseite für Hinweistexte. */
export function sideLabel(
  m: Pick<StageMatchToPlan, 'teamAId' | 'teamBId' | 'slotA' | 'slotB'>,
  side: 'A' | 'B',
  teamNames?: ReadonlyMap<string, string>,
): string {
  const team = side === 'A' ? m.teamAId : m.teamBId;
  const slot = side === 'A' ? m.slotA : m.slotB;
  if (team) return teamNames?.get(team) ?? team;
  return slot ? slotLabel(slot, teamNames) : 'offen';
}

/** Vorgänger-Spiele im selben Abschnitt (Sieger/Verlierer-Verweise), als Match-IDs. */
export function predecessorIds(
  m: Pick<StageMatchToPlan, 'stageId' | 'slotA' | 'slotB'>,
  byKey: ReadonlyMap<string, string>,
): Array<{ side: 'A' | 'B'; matchId: string }> {
  const out: Array<{ side: 'A' | 'B'; matchId: string }> = [];
  for (const [side, slot] of [['A', m.slotA], ['B', m.slotB]] as const) {
    if (slot && (slot.kind === 'winner' || slot.kind === 'loser')) {
      const id = byKey.get(`${slot.stageId}|${slot.matchKey}`);
      if (id !== undefined) out.push({ side, matchId: id });
    }
  }
  return out;
}

export function matchKeyIndex(matches: ReadonlyArray<Pick<StageMatchToPlan, 'id' | 'stageId' | 'matchKey'>>): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of matches) if (m.matchKey) map.set(`${m.stageId}|${m.matchKey}`, m.id);
  return map;
}

/** Phasen, die mit einer echten Endrunde beginnen, bekommen die Pause vor der Endrunde. */
const isFinalsKind = (s: StageConfig) => s.kind === 'knockout' || s.kind === 'final_group' || s.kind === 'placement';

interface Interval {
  start: number;
  end: number;
  matchId: string;
}

/**
 * Plant alle Spiele des Baukastens auf Zeiten und Felder.
 *
 * - Phasen nacheinander; zwischen ihnen die Rundenpause, vor der ersten Endrunde
 *   `format.breakBeforeFinalsMinutes` (jeweils mindestens die Wechselpause).
 * - Innerhalb einer Phase Anstoßzeiten im Takt „längstes Spiel der Welle + Wechselpause“;
 *   jedes Feld bekommt pro Welle das dringendste bereite Spiel: zuerst ohne zu kurze Pause,
 *   dann früherer Spieltag bzw. frühere K.-o.-Runde, dann (mit `evenRest`) wer am längsten
 *   gewartet hat, dann höhere Platzierungsspiele vor dem Finale.
 * - K.-o.-Spiele erst nach ihren Vorgänger-Spielen; Gruppen mit `fixedFields` bleiben auf
 *   ihren Feldern, wenn genug Felder da sind.
 * - Handänderungen (`manual`) und angepfiffene/beendete Spiele behalten Zeit und Feld.
 */
export function planTournamentDay(
  format: TournamentFormat,
  matches: readonly StageMatchToPlan[],
  fields: readonly ScheduleField[],
  constraints: DayPlanConstraints,
  options: PlanDayOptions = {},
): DayPlan {
  const plan: DayPlan = { matches: [], stages: [], phases: [], restWarnings: [], warnings: [], problems: [] };
  const active = fields.filter((f) => f.active).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  const fieldName = new Map(fields.map((f) => [f.id, f.name]));
  const names = options.teamNames;
  const turnover = constraints.turnoverMinutes;
  const softTarget = constraints.desiredRestMinutes ?? constraints.matchMinutes;
  const evenRest = constraints.evenRest !== false;
  if (active.length === 0) {
    plan.problems.push('Es ist kein aktives Spielfeld vorhanden.');
    return plan;
  }

  const stageById = new Map(format.stages.map((s) => [s.id, s]));
  const stageOrder = new Map(format.stages.map((s, i) => [s.id, i]));
  const order = new Map(matches.map((m, i) => [m.id, i]));
  const byKey = matchKeyIndex(matches);
  const duration = (m: StageMatchToPlan) =>
    m.durationMinutes ?? stageById.get(m.stageId)?.matchMinutes ?? constraints.matchMinutes;

  const unknown = matches.filter((m) => !stageById.has(m.stageId));
  if (unknown.length > 0) {
    plan.problems.push(`${unknown.length} Spiele gehören zu keinem Abschnitt des Turniers.`);
  }
  if (matches.some((m) => stageById.get(m.stageId)?.kind === 'swiss')) {
    plan.warnings.push('Das Schweizer System wird wie bisher Runde für Runde geplant, nicht hier.');
  }

  // K.-o.-Ebene: 1 + höchste Ebene der Vorgänger (Viertelfinale vor Halbfinale vor Finale).
  const levelMemo = new Map<string, number>();
  const byId = new Map(matches.map((m) => [m.id, m]));
  const level = (m: StageMatchToPlan, seen = new Set<string>()): number => {
    const known = levelMemo.get(m.id);
    if (known !== undefined) return known;
    if (seen.has(m.id)) return 1;
    seen.add(m.id);
    const preds = predecessorIds(m, byKey).map((p) => level(byId.get(p.matchId)!, seen));
    const l = preds.length > 0 ? 1 + Math.max(...preds) : (m.roundNumber ?? 1);
    levelMemo.set(m.id, l);
    return l;
  };

  // Belegung: Felder und Teilnehmer (Team oder Platzhalter) mit ihren Spielzeiten.
  const fieldBusy = new Map<string, Interval[]>();
  const partBusy = new Map<string, Interval[]>();
  const placed = new Map<string, PlannedStageMatch>();
  const occupy = (m: StageMatchToPlan, p: PlannedStageMatch) => {
    placed.set(m.id, p);
    const iv = { start: ms(p.startISO), end: ms(p.endISO), matchId: m.id };
    fieldBusy.set(p.fieldId, [...(fieldBusy.get(p.fieldId) ?? []), iv]);
    for (const k of sideKeys(m)) partBusy.set(k, [...(partBusy.get(k) ?? []), iv]);
  };

  const isKept = (m: StageMatchToPlan) =>
    !!m.startISO && !!m.fieldId && (m.manual === true || !EDITABLE_STATUSES.has(m.status ?? 'scheduled'));

  const plannable = matches.filter((m) => stageById.has(m.stageId) && stageById.get(m.stageId)!.kind !== 'swiss');
  for (const m of plannable) {
    if (!isKept(m)) continue;
    occupy(m, {
      matchId: m.id,
      stageId: m.stageId,
      phase: stageById.get(m.stageId)!.phase,
      fieldId: m.fieldId!,
      fieldName: fieldName.get(m.fieldId!) ?? m.fieldId!,
      startISO: m.startISO!,
      endISO: addMinutes(m.startISO!, duration(m)),
      waveIndex: -1,
      kept: true,
    });
  }

  /** Letztes Spielende eines Teilnehmers vor `t` (Vorgänger-Spiel zählt für Platzhalter mit). */
  const lastEndBefore = (m: StageMatchToPlan, side: 0 | 1, t: number): number | undefined => {
    let last: number | undefined;
    for (const iv of partBusy.get(sideKeys(m)[side]) ?? []) {
      if (iv.end <= t && (last === undefined || iv.end > last)) last = iv.end;
    }
    for (const p of predecessorIds(m, byKey)) {
      if ((p.side === 'A') !== (side === 0)) continue;
      const pm = placed.get(p.matchId);
      if (pm && ms(pm.endISO) <= t && (last === undefined || ms(pm.endISO) > last)) last = ms(pm.endISO);
    }
    return last;
  };

  const overlaps = (list: Interval[] | undefined, start: number, end: number, pad: number) =>
    (list ?? []).some((iv) => start < iv.end + pad && iv.start < end + pad);

  const phases = [...new Set(format.stages.map((s) => s.phase))].sort((a, b) => a - b);
  let cursor = ms(constraints.tournamentStartISO);
  let previousPhaseEnd: number | undefined;
  let finalsBreakUsed = false;
  let waveIndex = 0;

  for (const phase of phases) {
    const stages = format.stages.filter((s) => s.phase === phase && s.kind !== 'swiss');
    const phaseMatches = plannable.filter((m) => stageById.get(m.stageId)!.phase === phase);
    if (phaseMatches.length === 0) continue;

    if (previousPhaseEnd !== undefined) {
      const finals = !finalsBreakUsed && stages.some(isFinalsKind);
      const gap = finals ? format.breakBeforeFinalsMinutes : constraints.roundBreakMinutes;
      cursor = Math.max(cursor, previousPhaseEnd + Math.max(turnover, gap) * MS);
    }
    if (stages.some(isFinalsKind)) finalsBreakUsed = true;

    // Feste Felder je Gruppe: Feld k gehört zur Gruppe k mod G, übrige Felder sind frei.
    const fieldOwner = new Map<string, string>();
    let fixedGroups = stages.flatMap((s) =>
      s.kind === 'groups' && s.fixedFields ? Array.from({ length: s.groupCount }, (_, g) => `${s.id}|${g}`) : [],
    );
    if (fixedGroups.length > 0) {
      if (active.length >= fixedGroups.length) {
        const usable = fixedGroups.length * Math.floor(active.length / fixedGroups.length);
        active.slice(0, usable).forEach((f, k) => fieldOwner.set(f.id, fixedGroups[k % fixedGroups.length]!));
      } else {
        plan.warnings.push(
          `Für feste Gruppenfelder fehlen Felder (${fixedGroups.length} Gruppen, ${active.length} Felder); die Gruppen wechseln die Felder.`,
        );
        fixedGroups = [];
      }
    }
    const freeFields = active.filter((f) => !fieldOwner.has(f.id));
    const allowed = (m: StageMatchToPlan, f: ScheduleField): boolean => {
      const owner = fieldOwner.get(f.id);
      const own = `${m.stageId}|${m.groupIndex ?? 0}`;
      if (fixedGroups.includes(own)) return owner === own;
      return owner === undefined || freeFields.length === 0;
    };

    const pending = phaseMatches.filter((m) => !placed.has(m.id));
    const ready = (m: StageMatchToPlan, t: number) =>
      predecessorIds(m, byKey).every((p) => {
        const pm = placed.get(p.matchId);
        return pm !== undefined && ms(pm.endISO) + turnover * MS <= t;
      });

    let guard = 0;
    while (pending.length > 0) {
      if (++guard > 10_000) {
        plan.problems.push('Der Spielplan ließ sich nicht vollständig berechnen.');
        break;
      }
      const t = cursor;
      const restOf = (m: StageMatchToPlan, side: 0 | 1) => {
        const last = lastEndBefore(m, side, t);
        return last === undefined ? Infinity : (t - last) / MS;
      };
      const priority = (m: StageMatchToPlan): number[] => {
        const rests = [restOf(m, 0), restOf(m, 1)];
        const shortRests = rests.filter((r) => r < softTarget).length;
        const longestWait = Math.min(...rests.map((r) => (Number.isFinite(r) ? r : 1e9)));
        return [
          shortRests,
          level(m),
          evenRest ? -longestWait : 0,
          -(m.place ?? 0),
          stageOrder.get(m.stageId)! * 1000 + (m.groupIndex ?? 0),
          order.get(m.id)!,
        ];
      };
      const better = (a: number[], b: number[]) => {
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
        return false;
      };

      const chosen: Array<{ m: StageMatchToPlan; f: ScheduleField }> = [];
      const used = new Set<string>();
      for (const f of active) {
        let best: StageMatchToPlan | undefined;
        let bestKey: number[] = [];
        for (const m of pending) {
          if (chosen.some((c) => c.m === m) || !allowed(m, f) || !ready(m, t)) continue;
          const keys = sideKeys(m);
          if (keys.some((k) => used.has(k))) continue;
          const end = t + duration(m) * MS;
          if (overlaps(fieldBusy.get(f.id), t, end, turnover * MS)) continue;
          if (keys.some((k) => overlaps(partBusy.get(k), t, end, 0))) continue;
          const key = priority(m);
          if (!best || better(key, bestKey)) {
            best = m;
            bestKey = key;
          }
        }
        if (best) {
          chosen.push({ m: best, f });
          for (const k of sideKeys(best)) used.add(k);
        }
      }

      if (chosen.length === 0) {
        // Nichts passt jetzt: zum nächsten Zeitpunkt springen, an dem ein Feld oder Vorgänger frei wird.
        const candidates: number[] = [];
        for (const list of fieldBusy.values()) for (const iv of list) candidates.push(iv.end + turnover * MS);
        for (const pm of placed.values()) candidates.push(ms(pm.endISO) + turnover * MS);
        const next = candidates.filter((c) => c > t).sort((a, b) => a - b)[0];
        if (next === undefined) {
          plan.problems.push(
            `${pending.length} Spiele konnten nicht eingeplant werden (fehlen Vorgänger-Spiele oder passende Felder?).`,
          );
          break;
        }
        cursor = next;
        continue;
      }

      let waveLength = 0;
      for (const { m, f } of chosen) {
        const startISO = new Date(t).toISOString();
        occupy(m, {
          matchId: m.id,
          stageId: m.stageId,
          phase,
          fieldId: f.id,
          fieldName: f.name,
          startISO,
          endISO: addMinutes(startISO, duration(m)),
          waveIndex,
          kept: false,
        });
        waveLength = Math.max(waveLength, duration(m));
        pending.splice(pending.indexOf(m), 1);
      }
      waveIndex++;
      cursor = t + (waveLength + turnover) * MS;
    }

    const phaseEnd = Math.max(...phaseMatches.map((m) => placed.get(m.id)).filter((p) => p).map((p) => ms(p!.endISO)));
    const phaseStart = Math.min(...phaseMatches.map((m) => placed.get(m.id)).filter((p) => p).map((p) => ms(p!.startISO)));
    if (Number.isFinite(phaseEnd)) {
      plan.phases.push({ phase, startISO: new Date(phaseStart).toISOString(), endISO: new Date(phaseEnd).toISOString() });
      previousPhaseEnd = phaseEnd;
      cursor = Math.max(cursor, phaseEnd);
    }
  }

  for (const m of plannable) {
    const p = placed.get(m.id);
    if (p) plan.matches.push(p);
  }
  plan.matches.sort((a, b) => ms(a.startISO) - ms(b.startISO) || a.fieldName.localeCompare(b.fieldName, 'de'));

  for (const s of format.stages) {
    const list = plan.matches.filter((p) => p.stageId === s.id);
    if (list.length === 0) continue;
    plan.stages.push({
      stageId: s.id,
      startISO: list.map((p) => p.startISO).reduce((a, b) => (ms(b) < ms(a) ? b : a)),
      endISO: list.map((p) => p.endISO).reduce((a, b) => (ms(b) > ms(a) ? b : a)),
    });
  }
  if (plan.matches.length > 0) {
    plan.lastEndISO = plan.matches.map((p) => p.endISO).reduce((a, b) => (ms(b) > ms(a) ? b : a));
  }

  // Zu kurze Pausen melden: je Spielseite gegen das vorige Spiel des Teams bzw. den Vorgänger.
  for (const p of plan.matches) {
    const m = byId.get(p.matchId)!;
    const t = ms(p.startISO);
    ([0, 1] as const).forEach((side) => {
      const last = lastEndBefore(m, side, t);
      if (last === undefined) return;
      const rest = (t - last) / MS;
      if (rest < softTarget) {
        const who = sideLabel(m, side === 0 ? 'A' : 'B', names);
        plan.restWarnings.push({
          participant: sideKeys(m)[side],
          matchId: m.id,
          restMinutes: rest,
          targetMinutes: softTarget,
          message: `${who} hat vor dem nächsten Spiel nur ${rest} Minuten Pause (gewünscht: ${softTarget}).`,
        });
      }
    });
  }

  const unused = active.filter((f) => !plan.matches.some((p) => p.fieldId === f.id));
  if (unused.length > 0 && plan.matches.length > 0) {
    plan.warnings.push(`Nicht genutzte Felder: ${unused.map((f) => f.name).join(', ')}.`);
  }
  return plan;
}
