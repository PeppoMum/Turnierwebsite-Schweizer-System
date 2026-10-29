// Baukasten-Turnier speichern: erst das Turnier mit Format und Gruppeneinteilung, dann den Spielplan.
import type { TournamentService } from '../../data/service';
import type { WizardDraft } from '../../data/types';
import { toFormat, type BuilderState } from './builder';
import { potLists, type DrawState } from './draw';
import { planCreation, prelimDraw, toPlannedMatches } from './plan';
import { activeTeams } from './preview';

/**
 * Baukasten-Turnier anlegen: Turnier mit Format und Gruppeneinteilung speichern, dann den Spielplan
 * (Gruppenspiele mit Teams, Endrunden mit Platzhaltern) und auf Wunsch veröffentlichen.
 */
export async function createFormatTournament(
  service: TournamentService,
  draft: WizardDraft,
  builder: BuilderState,
  draw: DrawState,
  groups: string[][],
  publish: boolean,
): Promise<string> {
  const teamCount = activeTeams(draft).length;
  const format = toFormat(builder, teamCount, draw.mode);
  if (!format) throw new Error('Schweizer-System-Turniere werden ohne Baukasten angelegt.');
  const pots =
    draw.mode === 'pots'
      ? potLists(
          draw,
          activeTeams(draft).map((t) => t.id),
        )
      : undefined;
  const id = await service.createTournament(
    {
      ...draft,
      format,
      groupDraws: [prelimDraw(format, groups, draw.mode, draw.seed, pots)],
    },
    false,
  );
  const data = service.get(id);
  if (!data?.tournament.format) throw new Error('Das Turnier wurde angelegt, aber der Spielplan fehlt noch. Bitte lade die Seite neu.');
  const saved = data.groupDraws?.find((g) => g.stageId === format.stages[0]!.id)?.groups;
  const sched = data.tournament.schedule;
  const plan = planCreation(
    data.tournament.format,
    teamCount,
    data.fields.map((f) => ({
      id: f.id,
      name: f.name,
      order: f.order,
      active: f.active,
    })),
    {
      tournamentStartISO: sched.tournamentStartISO,
      matchMinutes: sched.matchMinutes,
      turnoverMinutes: sched.turnoverMinutes,
      roundBreakMinutes: sched.roundBreakMinutes,
      evenRest: sched.evenRest,
    },
    saved,
  );
  await service.saveStagePlan(id, toPlannedMatches(data.tournament.format, plan, sched.matchMinutes));
  if (publish) await service.publishTournament(id);
  return id;
}
