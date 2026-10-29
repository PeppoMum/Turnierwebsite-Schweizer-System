// Deutsche Texte zur Gruppenwertung für die Oberfläche.
import type { GroupTieBreaker, TieBreakVariant } from '../format/types';

export const GROUP_TIE_BREAKER_LABELS: Record<GroupTieBreaker, string> = {
  head_to_head: 'Direkter Vergleich',
  goal_diff: 'Tordifferenz',
  goals_for: 'Mehr Tore',
  wins: 'Mehr Siege',
};

export const TIE_BREAK_VARIANT_LABELS: Record<TieBreakVariant, string> = {
  h2h_first: 'Direkter Vergleich zuerst',
  goals_first: 'Tordifferenz zuerst',
};

export const HEAD_TO_HEAD_EXPLANATION =
  'Beim direkten Vergleich zählen nur die Spiele der punktgleichen Teams untereinander: erst die Punkte daraus, ' +
  'dann die Tordifferenz, dann die Tore. Sind danach immer noch Teams gleich, wird der Vergleich nur unter ihnen wiederholt.';

export const GROUP_LOT_EXPLANATION =
  'Sind Teams in allen Punkten gleich, entscheidet das Los. Die Turnierleitung zieht es, bis dahin ist die Reihenfolge vorläufig.';
