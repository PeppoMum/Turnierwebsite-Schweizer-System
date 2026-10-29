// Ansichtsdaten der Zuschauerseite, gemeinsam für alle Reiter.
import type { PublicMatch, PublicTournamentView } from '../../data/types';
import type { TeamInfo } from '../../components/StandingsTable';
import { STAGE_COLORS, type SideView, type StageModel } from './stageView';

export interface Ctx {
  view: PublicTournamentView;
  teams: Map<string, TeamInfo>;
  field: (id?: string) => string;
  scores: boolean;
  /** Nur bei Baukasten-Turnieren (mit Gruppen oder Endrunde). */
  model: StageModel | null;
}

export function pickerTeams(view: PublicTournamentView) {
  return view.teams.filter((t) => t.status !== 'inactive').map((t) => ({ id: t.id, name: t.name, logo: t.logo }));
}

export function teamName(ctx: Ctx, id: string | null | undefined): string {
  return (id && ctx.teams.get(id)?.name) || '';
}

/** Name einer Spielseite; Platzhalter, solange das Team nicht feststeht. */
export function sideName(ctx: Ctx, s: SideView): string {
  return s.teamId ? teamName(ctx, s.teamId) || '?' : (s.slotLabel ?? 'Noch offen');
}

export function sidesOf(ctx: Ctx, m: PublicMatch): [SideView, SideView] {
  if (!ctx.model) return [{ teamId: m.teamAId || null, provisional: false }, { teamId: m.teamBId || null, provisional: false }];
  return [ctx.model.side(m, 'A'), ctx.model.side(m, 'B')];
}

export function stageColorOf(ctx: Ctx, m: PublicMatch): string | undefined {
  const stage = ctx.model?.stageOf(m.stageId);
  if (!stage || stage.phase === 0 || stage.color === 'neutral') return undefined;
  return STAGE_COLORS[stage.color];
}
