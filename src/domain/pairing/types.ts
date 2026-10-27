import type { PairingDiagnostics, PairingMode } from '../types';

/**
 * Eingabe des Pairers je aktiver Mannschaft. Die Werte kommen aus der Wertung
 * (src/domain/scoring) und enthalten nur echte, ausgetragene Spiele. Spiele gegen
 * zurückgezogene Teams sind dort bereits für alle gelöscht.
 */
export interface PairingTeam {
  id: string;
  /** Anzeigename, nur für verständliche Hinweistexte. */
  name?: string;
  /** Tatsächlich erzielte Punkte (3/1/0). */
  points: number;
  /** Tatsächlich ausgetragene Spiele (`completed`). */
  played: number;
  /** Bisherige Freilose. */
  byes: number;
  /** Rundennummer des letzten Freiloses, falls vorhanden. */
  lastByeRound?: number;
}

/** Eine bisherige (oder fest eingeplante) Begegnung zweier Teams. */
export interface PastMeeting {
  teamAId: string;
  teamBId: string;
  roundNumber?: number;
}

/**
 * Tuning-Gewichte der Kantenkosten (Spezifikation §7.2, OFFEN 3). Sie sind bewusst
 * transparent und pro Turnier überschreibbar, nicht als endgültige Regel gedacht.
 */
export interface PairingWeights {
  /** Gewicht der quadrierten, auf 0..1 normierten Quotenlücke. */
  quotient: number;
  /** Gewicht je Wiederholung, quadratisch in der Anzahl bisheriger Begegnungen. */
  rematch: number;
  /** Zusatzstrafe, wenn sich zwei Teams zum dritten (oder weiteren) Mal träfen. */
  tripleEncounter: number;
  /** Gewicht für unterschiedliche Spielzahlen (kleine Stichproben zählen stärker). */
  playedGap: number;
  /**
   * Dämpfung der Quotengewichtung in frühen Runden: effektives Quotengewicht =
   * quotient · s / (s + confidenceDamping), s = mittlere Spielzahl. 0 = aus.
   */
  confidenceDamping: number;
  /** Strafe je Spiel, das der Freilos-Kandidat weniger als das Maximum gespielt hat. */
  byePlayedDeficit: number;
  /** Strafe für ein Freilos in der unmittelbar vorigen Runde. */
  byeRecent: number;
  /** Maximaler seeded Zufallsanteil je Kante, nur zur Gleichstandsauflösung. */
  jitter: number;
}

export type PairingKind = 'draw' | 'swiss';

export interface Pairing {
  teamAId: string;
  teamBId: string;
  /** Wie oft sich die beiden schon begegnet sind (vor dieser Runde). */
  previousMeetings: number;
  /** Absoluter Abstand der Paarungsquoten (0..3). */
  quotientGap: number;
  /** Kantenkosten dieser Paarung. */
  cost: number;
}

export interface ByeCandidateEvaluation {
  teamId: string;
  /** Gesamtkosten der Runde, wenn dieses Team das Freilos erhält; null = unmöglich. */
  totalCost: number | null;
  chosen: boolean;
}

export interface PairingAlternative {
  label: string;
  objectiveCost: number;
  repeats: number;
  maxQuotientGap: number;
  byeTeamId?: string;
  pairings: Array<Pick<Pairing, 'teamAId' | 'teamBId'>>;
}

/** Erweiterte, erklärbare Diagnose; Obermenge von `PairingDiagnostics` aus §5. */
export interface ExtendedPairingDiagnostics extends PairingDiagnostics {
  /** Wiederholte Begegnungen dieser Runde mit Anzahl bisheriger Treffen. */
  rematches: Array<{ teamAId: string; teamBId: string; previousMeetings: number }>;
  /** Bewertete Freilos-Kandidaten (bei ungerader Teamzahl). */
  byeCandidates: ByeCandidateEvaluation[];
  /** Begründungen für eingegangene Kompromisse, deutsch. */
  explanations: string[];
  /** Vorgeschlagene Alternativen, z. B. die beste Runde ganz ohne Wiederholung. */
  alternatives: PairingAlternative[];
  /** Existiert für diese Runde ein vollständiges Matching ohne Wiederholung? */
  noRematchFeasible: boolean;
  /** Tatsächlich verwendete Gewichte (inkl. Dämpfung). */
  weights: PairingWeights;
  effectiveQuotientWeight: number;
}

export interface PairingPlan {
  roundNumber: number;
  kind: PairingKind;
  mode: PairingMode;
  seed: string;
  pairings: Pairing[];
  byeTeamId?: string;
  /**
   * `needs_confirmation`: Im Modus `strict_no_rematch` ist keine Runde ohne
   * Wiederholung möglich. Der Plan enthält dann den ausgewogenen Vorschlag, den
   * der Admin ausdrücklich bestätigen muss.
   */
  status: 'ok' | 'needs_confirmation';
  diagnostics: ExtendedPairingDiagnostics;
}
