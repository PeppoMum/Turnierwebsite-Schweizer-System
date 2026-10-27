// Deutsche Texte zur Wertung für die Oberfläche (Info-Buttons, Einstellungen).
import type { BuchholzVariant, TieBreaker } from '../types';

export const TIE_BREAKER_LABELS: Record<TieBreaker, string> = {
  head_to_head: 'Direkter Vergleich',
  goal_diff: 'Tordifferenz',
  goals_for: 'Erzielte Tore',
  buchholz: 'Buchholz',
};

export const BUCHHOLZ_VARIANT_LABELS: Record<BuchholzVariant, string> = {
  avg_opponent_quotient: 'Durchschnittlicher Quotient deiner Gegner',
  sum_opponent_quotient: 'Summe der Quotienten deiner Gegner',
  sum_opponent_points: 'Summe der Punkte deiner Gegner',
};

export const BUCHHOLZ_EXPLANATION =
  'Die Buchholz-Zahl bewertet, wie stark deine bisherigen Gegner waren. Standardmäßig ist sie der ' +
  'Durchschnitt der Punktequotienten aller Gegner, gegen die du gewertet gespielt hast. Freilose und ' +
  'nicht ausgetragene Spiele zählen nicht, Spiele gegen zurückgezogene Teams ebenfalls nicht. Wer gegen ' +
  'stärkere Gegner gespielt hat, steht bei Gleichstand weiter oben.';

export const LOT_EXPLANATION =
  'Sind zwei Teams in allen Kriterien gleich, entscheidet ein Los. Es ist an das Turnier gebunden und ' +
  'ergibt bei denselben Ergebnissen immer dieselbe Reihenfolge.';
