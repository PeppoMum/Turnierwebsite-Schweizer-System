// Zusatzangaben für die Spielkarte (MatchCard) bei Baukasten-Spielen.
import type { Match } from '../../../../domain';
import type { TournamentData } from '../../../data/types';
import type { FinalsRules } from './FinalsResultDialog';
import { filledFinalsFrom, isFinalsStage, matchTitle, resultText, sideText, stageById } from './model';

const CORRECT_GROUP =
  'Ändert sich durch die Korrektur, wer weiterkommt, zeigen wir dir die Änderung danach an und du bestätigst sie. ' +
  'Endrunden-Spiele, die schon laufen oder vorbei sind, bleiben, wie sie sind.';

const CORRECT_FINALS =
  'Der Sieger dieses Spiels steht schon im nächsten Spiel. Ändert sich der Sieger, zeigen wir dir die Änderung danach an und du ' +
  'bestätigst sie. Läuft das nächste Spiel schon, bleibt es, wie es ist.';

export interface StageCardProps {
  title: string;
  nameA: string;
  nameB: string;
  finals?: FinalsRules;
  resultLabel: string;
  correctWarning: string | null;
}

export function stageCardProps(d: TournamentData, m: Match, teamName: (id: string) => string): StageCardProps | undefined {
  const format = d.tournament.format;
  if (!format || !m.stageId) return undefined;
  const stage = stageById(format, m.stageId);
  const finals = isFinalsStage(stage) && stage && (stage.kind === 'knockout' || stage.kind === 'placement')
    ? {
        penaltyOnly: Boolean(m.penaltyOnly),
        extraTime: stage.drawDecider === 'extra_time_then_penalties',
      }
    : undefined;
  let correctWarning: string | null = null;
  if (m.status === 'completed' || m.status === 'not_played') {
    if (finals && m.matchKey) {
      const feeds = d.matches.some(
        (x) =>
          (x.teamAId && x.slotA && (x.slotA.kind === 'winner' || x.slotA.kind === 'loser') && x.slotA.stageId === m.stageId && x.slotA.matchKey === m.matchKey) ||
          (x.teamBId && x.slotB && (x.slotB.kind === 'winner' || x.slotB.kind === 'loser') && x.slotB.stageId === m.stageId && x.slotB.matchKey === m.matchKey),
      );
      if (feeds) correctWarning = CORRECT_FINALS;
    } else if (filledFinalsFrom(d, m.stageId).length > 0) {
      correctWarning = CORRECT_GROUP;
    }
  }
  return {
    title: matchTitle(m, format),
    nameA: sideText(m, 'A', format, teamName),
    nameB: sideText(m, 'B', format, teamName),
    finals,
    resultLabel: resultText(m, format),
    correctWarning,
  };
}
