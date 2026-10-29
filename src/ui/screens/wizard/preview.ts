// Zahlen und Ablauf für die Live-Skizze: aus Assistent-Entwurf, Baukasten und Gruppeneinteilung.
import type { TournamentFormat } from '../../../domain/format';
import { previewFormat, type DayPlanConstraints, type ScheduleField } from '../../../domain/schedule';
import { localStartISO } from '../../data/mockStore';
import type { WizardDraft } from '../../data/types';
import { checkBuilder, toFormat, type BuilderCheck, type BuilderState } from './builder';
import type { DrawState } from './draw';
import { planCreation, type CreationPlan } from './plan';

export interface WizardPreview {
  teamCount: number;
  format: TournamentFormat | null;
  check: BuilderCheck;
  plan: CreationPlan | null;
  gamesPerTeam: { min: number; max: number } | null;
  firstStartISO?: string;
  lastStartISO?: string;
  lastEndISO?: string;
  /** Hinweise aus der Spielplanung (Pausen, Felder). */
  warnings: string[];
}

export function activeTeams(draft: WizardDraft) {
  return draft.teams.filter((t) => t.active && t.name.trim());
}

export function scheduleFields(draft: WizardDraft): ScheduleField[] {
  return draft.fields.map((f, i) => ({
    id: f.id,
    name: f.name.trim() || `Feld ${i + 1}`,
    order: i,
    active: true,
  }));
}

export function dayConstraints(draft: WizardDraft): DayPlanConstraints {
  return {
    tournamentStartISO: localStartISO(draft.localDate, draft.startTime, draft.timeZone),
    matchMinutes: Math.max(1, draft.matchMinutes || 1),
    turnoverMinutes: Math.max(0, draft.turnoverMinutes || 0),
    roundBreakMinutes: Math.max(0, draft.roundBreakMinutes || 0),
    evenRest: draft.restOptimization,
  };
}

/** Skizze für die aktuellen Einstellungen; `groups` ist die Einteilung aus dem Schritt „Gruppen auslosen“. */
export function buildPreview(draft: WizardDraft, builder: BuilderState, draw: DrawState, groups?: string[][]): WizardPreview {
  const teamCount = activeTeams(draft).length;
  const check = checkBuilder(builder, teamCount);
  const format = check.errors.length === 0 ? toFormat(builder, teamCount, draw.mode) : null;
  if (!format || draft.fields.length === 0) {
    return {
      teamCount,
      format,
      check,
      plan: null,
      gamesPerTeam: null,
      warnings: [],
    };
  }
  let plan: CreationPlan;
  try {
    plan = planCreation(format, teamCount, scheduleFields(draft), dayConstraints(draft), groups);
  } catch {
    // Unvollständige Eingaben (z. B. leeres Datum) dürfen die Skizze nicht abstürzen lassen.
    return {
      teamCount,
      format,
      check,
      plan: null,
      gamesPerTeam: null,
      warnings: [],
    };
  }
  const games = previewFormat(format, teamCount, scheduleFields(draft), dayConstraints(draft)).gamesPerTeam;
  const starts = plan.day.matches.map((m) => m.startISO).sort();
  return {
    teamCount,
    format,
    check,
    plan,
    gamesPerTeam: games,
    firstStartISO: starts[0],
    lastStartISO: starts[starts.length - 1],
    lastEndISO: plan.day.lastEndISO,
    warnings: [...plan.day.problems, ...plan.day.warnings],
  };
}

/** Anzeigename einer K.-o.-Runde aus dem Spielschlüssel. */
export function roundLabel(matchKey: string | undefined): string {
  if (!matchKey) return 'Spiele';
  if (matchKey === 'F') return 'Finale';
  if (matchKey === 'P3') return 'Spiel um Platz 3';
  if (/^SF/.test(matchKey)) return 'Halbfinale';
  if (/^QF/.test(matchKey)) return 'Viertelfinale';
  if (/^R16/.test(matchKey)) return 'Achtelfinale';
  if (/^R32/.test(matchKey)) return 'Sechzehntelfinale';
  const place = /^P(\d+)$/.exec(matchKey);
  if (place) return `Spiel um Platz ${place[1]}`;
  return 'Platzierungsspiele';
}
