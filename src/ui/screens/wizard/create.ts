// Baukasten-Turnier speichern: erst das Turnier mit Format und Gruppeneinteilung, dann den Spielplan.
import type { TournamentService } from '../../data/service';
import type { TournamentData, WizardDraft } from '../../data/types';
import { toFormat, type BuilderState } from './builder';
import { potLists, type DrawState } from './draw';
import { planCreation, prelimDraw, toPlannedMatches } from './plan';
import { activeTeams } from './preview';

/**
 * Baukasten-Turnier anlegen: Turnier mit Format und Gruppeneinteilung speichern, dann den Spielplan
 * (Gruppenspiele mit Teams, Endrunden mit Platzhaltern) und auf Wunsch veröffentlichen.
 * `resume`: Das Turnier wurde bei einem früheren Versuch schon angelegt (`onCreated`), dann nur den
 * Rest nachholen – ein zweites Anlegen mit derselben ID lehnen die Schutzregeln ab.
 */
export async function createFormatTournament(
  service: TournamentService,
  draft: WizardDraft,
  builder: BuilderState,
  draw: DrawState,
  groups: string[][],
  publish: boolean,
  resume?: { created: string | null; onCreated: (id: string) => void },
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
  const id =
    resume?.created ??
    (await service.createTournament(
      {
        ...draft,
        format,
        groupDraws: [prelimDraw(format, groups, draw.mode, draw.seed, pots)],
      },
      false,
    ));
  resume?.onCreated(id);
  const firstStage = format.stages[0]!;
  const needsGroups = firstStage.kind === 'groups' && !firstStage.entry;
  // Firebase liefert das neue Turnier erst kurz nach dem Speichern: warten, bis Teams und Gruppen da sind,
  // sonst würde der Spielplan mit Ersatz-Teams gebaut.
  const data = await loaded(service, id, (d) =>
    !!d.tournament.format && d.teams.length >= teamCount && (!needsGroups || !!d.groupDraws?.some((g) => g.stageId === firstStage.id)),
  );
  if (!data?.tournament.format) throw new Error('Das Turnier wurde angelegt, aber der Spielplan fehlt noch. Bitte lade die Seite neu.');
  const saved = data.groupDraws?.find((g) => g.stageId === firstStage.id)?.groups;
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
  if (data.matches.length === 0) await service.saveStagePlan(id, toPlannedMatches(data.tournament.format, plan, sched.matchMinutes));
  if (publish) await service.publishTournament(id);
  return id;
}

/** Das Turnier, sobald `ready` zutrifft; nach `ms` ohne Erfolg undefined. */
function loaded(service: TournamentService, id: string, ready: (d: TournamentData) => boolean, ms = 15000): Promise<TournamentData | undefined> {
  return new Promise((resolve) => {
    let done = false;
    const check = () => {
      const d = service.get(id);
      if (done || !d || !ready(d)) return;
      finish(d);
    };
    const finish = (d: TournamentData | undefined) => {
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(d);
    };
    const timer = setTimeout(() => finish(undefined), ms);
    const unsubscribe = service.subscribe(check);
    check();
  });
}
