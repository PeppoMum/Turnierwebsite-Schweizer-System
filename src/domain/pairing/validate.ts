import type { PairingMode } from '../types';
import { edgeCost, effectiveQuotientWeight, neutralPrior, resolveWeights } from './cost';
import { formatNumber, teamLabel } from './format';
import { MeetingCounter } from './meetings';
import type { PairingTeam, PairingWeights, PastMeeting } from './types';

export interface ProposedPlan {
  pairings: ReadonlyArray<{ teamAId: string; teamBId: string }>;
  byeTeamId?: string;
}

export interface ValidatePlanInput {
  /** Aktive Teams der Runde. */
  teams: readonly PairingTeam[];
  plan: ProposedPlan;
  meetings?: readonly PastMeeting[];
  mode?: PairingMode;
  /** Für die Kostenberechnung (gleicher Seed wie der Vorschlag). */
  seed?: string;
  weights?: Partial<PairingWeights>;
  /** Kosten des berechneten Optimums, um die Verschlechterung auszuweisen. */
  optimalCost?: number;
}

export interface ValidationReport {
  /** `false` bei harten Fehlern: Plan darf so nicht veröffentlicht werden. */
  valid: boolean;
  errors: string[];
  /** Weiche Hinweise, z. B. Wiederholungen oder unfaire Freilose. */
  warnings: string[];
  repeats: number;
  objectiveCost: number;
  /** Mehrkosten gegenüber dem Optimum, falls `optimalCost` angegeben. */
  costDelta?: number;
}

/**
 * Prüft einen (z. B. manuell getauschten) Paarungsplan (§7.2 Schritt 7, §11 validatePairingPlan).
 * Harte Fehler: Team fehlt, doppelt, unbekannt, gegen sich selbst, Freilos-Regeln verletzt.
 * Warnungen: Wiederholungen (im Strict-Modus Fehler), Freilos-Fairness, große Quotenlücken.
 */
export function validatePairingPlan(input: ValidatePlanInput): ValidationReport {
  const mode = input.mode ?? 'balanced';
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(input.teams.map((t) => [t.id, t]));
  const names = new Map(input.teams.map((t) => [t.id, t.name ?? t.id]));
  const seen = new Map<string, number>();
  const mark = (id: string) => seen.set(id, (seen.get(id) ?? 0) + 1);

  for (const p of input.plan.pairings) {
    if (p.teamAId === p.teamBId) errors.push(`${teamLabel(names, p.teamAId)} kann nicht gegen sich selbst spielen.`);
    mark(p.teamAId);
    mark(p.teamBId);
  }
  if (input.plan.byeTeamId !== undefined) mark(input.plan.byeTeamId);

  for (const [id, n] of seen) {
    if (!byId.has(id)) errors.push(`Team ${id} ist nicht aktiv oder unbekannt und darf nicht eingeplant werden.`);
    else if (n > 1) errors.push(`${teamLabel(names, id)} ist in dieser Runde ${n}-mal eingeplant.`);
  }
  for (const t of input.teams) {
    if (!seen.has(t.id)) errors.push(`${teamLabel(names, t.id)} hat weder Gegner noch Freilos.`);
  }

  const odd = input.teams.length % 2 === 1;
  if (odd && input.plan.byeTeamId === undefined) errors.push('Bei ungerader Teamzahl braucht genau ein Team ein Freilos.');
  if (!odd && input.plan.byeTeamId !== undefined) errors.push('Bei gerader Teamzahl gibt es kein Freilos.');
  if (input.plan.byeTeamId !== undefined && byId.has(input.plan.byeTeamId)) {
    const bye = byId.get(input.plan.byeTeamId)!;
    const minByes = Math.min(...input.teams.map((t) => t.byes));
    if (bye.byes > minByes) {
      const without = input.teams.filter((t) => t.byes === minByes).length;
      warnings.push(
        `${teamLabel(names, bye.id)} hätte bereits ${bye.byes} Freilos(e), obwohl ${without} Team(s) erst ${minByes} hatten.`,
      );
    }
  }

  const meetings = new MeetingCounter(input.meetings ?? []);
  const weights = resolveWeights(mode, input.weights);
  const teams = [...byId.values()];
  const ctx = {
    weights,
    quotientWeight: effectiveQuotientWeight(teams, weights),
    meetings,
    prior: neutralPrior(teams),
    seed: input.seed ?? '',
  };
  let repeats = 0;
  let objectiveCost = 0;
  for (const p of input.plan.pairings) {
    const a = byId.get(p.teamAId);
    const b = byId.get(p.teamBId);
    if (!a || !b || a === b) continue;
    const e = edgeCost(a, b, ctx);
    objectiveCost += e.total;
    if (e.previousMeetings > 0) {
      repeats++;
      const text = `${teamLabel(names, a.id)} – ${teamLabel(names, b.id)} wäre die ${e.previousMeetings + 1}. Begegnung.`;
      if (mode === 'strict_no_rematch') errors.push(`${text} Im Modus „Keine Wiederholungen“ nicht erlaubt.`);
      else warnings.push(text);
    }
    if (e.quotientGap >= 1.5) {
      warnings.push(
        `Große Quotenlücke (${formatNumber(e.quotientGap)}) zwischen ${teamLabel(names, a.id)} und ${teamLabel(names, b.id)}.`,
      );
    }
  }

  const report: ValidationReport = { valid: errors.length === 0, errors, warnings, repeats, objectiveCost };
  if (input.optimalCost !== undefined) {
    report.costDelta = objectiveCost - input.optimalCost;
    if (report.costDelta > 1e-6) {
      warnings.push(`Der geänderte Plan ist um ${formatNumber(report.costDelta, 1)} Kostenpunkte schlechter als der berechnete Vorschlag.`);
    }
  }
  return report;
}

/**
 * Manueller Tausch: Team X und Team Y wechseln ihre Plätze (auch mit dem Freilos).
 * Gibt einen neuen Plan nur mit Paarungen/Freilos zurück (Kosten und Diagnose
 * danach mit `validatePairingPlan` neu bestimmen); der Ausgangsplan bleibt unverändert.
 */
export function swapTeams(plan: ProposedPlan, x: string, y: string): ProposedPlan {
  if (x === y) throw new Error('Bitte zwei verschiedene Teams zum Tauschen wählen.');
  const sub = (id: string) => (id === x ? y : id === y ? x : id);
  const partner = plan.pairings.find((p) => (p.teamAId === x && p.teamBId === y) || (p.teamAId === y && p.teamBId === x));
  if (partner) throw new Error('Die beiden Teams spielen bereits gegeneinander; ein Tausch ändert nichts.');
  const next: ProposedPlan = {
    pairings: plan.pairings.map((p) => ({ teamAId: sub(p.teamAId), teamBId: sub(p.teamBId) })),
  };
  if (plan.byeTeamId !== undefined) next.byeTeamId = sub(plan.byeTeamId);
  return next;
}
