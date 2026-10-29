// Ansichtsdaten der Oberfläche. Die Fachtypen kommen aus src/domain; hier nur, was die UI zusätzlich bündelt.
import type {
  Bye,
  Field,
  Match,
  NotPlayedReason,
  PairingMode,
  Round,
  Sponsor,
  Team,
  TieBreaker,
  Tournament,
  Visibility,
} from '../../domain';
import type { TeamStanding } from '../../domain/scoring';
import type { PairingPreview } from '../../domain/pairing';
import type { RoundTiming } from '../../domain/schedule';
import type { DrawMode, StageMatchFields, TournamentFormat } from '../../domain/format';

/** Alles, was die Admin-Ansichten zu einem Turnier brauchen. */
export interface TournamentData {
  tournament: Tournament;
  teams: Team[];
  fields: Field[];
  sponsors: Sponsor[];
  rounds: Round[];
  matches: Match[];
  byes: Bye[];
  /** Kleine Bilder als Data-URL, nach Asset-ID. */
  assets: Record<string, string>;
  /** Baukasten: Gruppeneinteilung je Gruppenabschnitt. Fehlt bei Schweizer-System-Turnieren. */
  groupDraws?: GroupDraw[];
  /** Baukasten: gezogene Lose bei Gleichstand. */
  lots?: LotDecision[];
}

/** Gruppeneinteilung eines Gruppenabschnitts (Vorrunde oder Zwischenrunde). */
export interface GroupDraw {
  stageId: string;
  /** Team-IDs je Gruppe, Index 0 = Gruppe A. */
  groups: string[][];
  mode: DrawMode;
  /** Nur bei `pots`: Team-IDs je Lostopf. */
  pots?: string[][];
  /** Zufallszahl der Auslosung, damit sie sich nachvollziehen lässt. */
  seed?: number;
  updatedAt: string;
}

/** Ein gezogenes Los: Reihenfolge punktgleicher Teams, die sonst nichts mehr trennt. */
export interface LotDecision {
  id: string;
  stageId: string;
  /** Gruppe im Abschnitt; fehlt beim Vergleich über alle Gruppen (beste Dritte). */
  groupIndex?: number;
  /** Bei `best_of_place`: welcher Gruppenplatz verglichen wurde. */
  place?: number;
  /** Die betroffenen Teams in der gezogenen Reihenfolge, das erste steht vorn. */
  order: string[];
  atISO: string;
}

/**
 * Ein Spiel im Baukasten-Spielplan, wie es gespeichert wird. Kommt aus der Spielplan-Logik
 * (src/domain/schedule); fehlende Teams stehen als Platzhalter in `slotA`/`slotB`.
 */
export interface PlannedStageMatch extends StageMatchFields {
  /** Fehlt bei neuen Spielen; die Datenhaltung vergibt dann eine. */
  id?: string;
  teamAId?: string;
  teamBId?: string;
  fieldId?: string;
  waveIndex?: number;
  startISO?: string;
  durationMinutes: number;
  manual?: boolean;
}

/** „Turnier umstellen“ übernehmen (Vorschlag aus src/ui/screens/admin/stages/reshape.ts). */
export interface ReshapeChange {
  /** Name des Vorschlags für den Verlauf, z. B. „3 Gruppen mit je 5“. */
  title: string;
  format: TournamentFormat;
  /** Neue Einteilung der Vorrunde; fehlt = bleibt. */
  groups?: string[][];
  /** Teams, die nicht erschienen sind (vorher aktiv). */
  missingTeamIds: string[];
  /** Alle noch nicht angepfiffenen Baukasten-Spiele danach. */
  plan: PlannedStageMatch[];
}

/** Ergebnis eines Endrunden-Spiels mit Verlängerung oder Neunmeterschießen. */
export interface KnockoutResult {
  /** Stand nach regulärer Spielzeit bzw. nach Verlängerung. Bei reinen Neunmeterspielen 0:0. */
  goalsA: number;
  goalsB: number;
  decidedBy: 'regular' | 'extra_time' | 'penalties';
  penaltiesA?: number;
  penaltiesB?: number;
}

/** Ein Team (oder Platzhalter) auf einer Seite eines Spiels. */
export interface MatchSide {
  matchId: string;
  side: 'A' | 'B';
}

/** Ein Eintrag beim Füllen der Endrunde: dieses Team kommt auf diese Seite. */
export interface SlotFill extends MatchSide {
  teamId: string;
}

/** Was passiert, wenn ein schon qualifiziertes Team vor seinem Endrunden-Spiel zurückzieht. */
export type WithdrawalChoice = { kind: 'walkover' } | { kind: 'replace'; byTeamId: string };

/** Was sich an Ort und Zeit eines Spiels von Hand ändern lässt. */
export interface MatchMove {
  fieldId?: string;
  startISO?: string;
}

/** Tabellenzeile aus src/domain/scoring. Rang ist null bei nicht wertungsberechtigten Teams. */
export type StandingRow = TeamStanding;

/** Vorschau der nächsten Runde aus src/domain/pairing. */
export type { PairingPreview };

/** Öffentliche Projektion. Im Kinderfußballmodus enthält sie keine Tore und keine Tabelle. */
export interface PublicMatch extends Partial<StageMatchFields> {
  id: string;
  roundNumber: number;
  teamAId: string;
  teamBId: string;
  fieldId?: string;
  waveIndex?: number;
  startISO?: string;
  /** Spieldauer in Minuten (fehlt bei älteren Projektionen). */
  durationMinutes?: number;
  status: Match['status'];
  goalsA?: number;
  goalsB?: number;
}

export interface PublicTournamentView {
  tournament: Pick<
    Tournament,
    'id' | 'title' | 'organizerName' | 'venue' | 'localDate' | 'timeZone' | 'status' | 'visibility' | 'roundsTotal' | 'currentRound'
  >;
  organizerLogo?: string;
  eventLogo?: string;
  teams: Array<Pick<Team, 'id' | 'name' | 'status'> & { logo?: string }>;
  fields: Array<Pick<Field, 'id' | 'name' | 'order'>>;
  sponsors: Array<Pick<Sponsor, 'id' | 'name' | 'url'> & { logo?: string }>;
  rounds: Array<Pick<Round, 'number' | 'plannedStartISO' | 'status'>>;
  matches: PublicMatch[];
  byes: Array<{ roundNumber: number; teamId: string }>;
  standings?: StandingRow[];
  /** Zeitwerte für die ungefähren Startzeiten aller Runden (fehlt bei älteren Projektionen). */
  timing?: RoundTiming;
  /** Baukasten: Ablauf, Gruppeneinteilung und Lose. Fehlt bei Schweizer-System-Turnieren. */
  format?: TournamentFormat;
  groupDraws?: Array<Pick<GroupDraw, 'stageId' | 'groups'>>;
  lots?: LotDecision[];
  updatedAt: string;
}

export interface WizardDraft {
  /** Wird vorab vergeben, damit Link und QR-Code schon im Assistenten stehen. */
  id: string;
  title: string;
  organizerName: string;
  venue: string;
  localDate: string;
  timeZone: string;
  organizerLogo?: string;
  eventLogo?: string;
  sponsors: Array<{ id: string; name: string; url: string; logo?: string }>;
  teams: Array<{ id: string; name: string; active: boolean; logo?: string }>;
  roundsTotal: number;
  preDrawRounds: number;
  pairingMode: PairingMode;
  tieBreakers: TieBreaker[];
  buchholzEnabled: boolean;
  fields: Array<{ id: string; name: string }>;
  startTime: string;
  matchMinutes: number;
  turnoverMinutes: number;
  roundBreakMinutes: number;
  restOptimization: boolean;
  hardRestMinutes: number | null;
  allocation: 'max_capacity' | 'balanced_waves';
  visibility: Visibility;
  /**
   * Baukasten: Ablauf des Turniers. Gesetzt = keine Schweizer-System-Runde, stattdessen Abschnitte;
   * die Felder roundsTotal, preDrawRounds, pairingMode, tieBreakers gelten dann nicht.
   */
  format?: TournamentFormat;
  /** Baukasten: Gruppeneinteilung direkt aus dem Assistenten (Team-IDs aus `teams`). */
  groupDraws?: Array<Omit<GroupDraw, 'updatedAt'>>;
}

/** Stammdaten, die nach dem Anlegen änderbar sind. Bilder als Data-URL, undefined = kein Bild. */
export interface TournamentDetails {
  title: string;
  organizerName: string;
  venue: string;
  localDate: string;
  organizerLogo?: string;
  eventLogo?: string;
  sponsors: Array<{ id: string; name: string; url: string; logo?: string }>;
}

/** Name und Logo einer Mannschaft (neu oder bestehend). */
export interface TeamEdit {
  name: string;
  logo?: string;
}

/** Ein Eintrag im Änderungsverlauf (Audit). */
export interface HistoryEntry {
  id: string;
  atISO: string;
  actorUid: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
}

export type { NotPlayedReason };
