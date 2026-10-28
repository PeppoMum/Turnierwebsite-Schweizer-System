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
}

/** Tabellenzeile aus src/domain/scoring. Rang ist null bei nicht wertungsberechtigten Teams. */
export type StandingRow = TeamStanding;

/** Vorschau der nächsten Runde aus src/domain/pairing. */
export type { PairingPreview };

/** Öffentliche Projektion. Im Kinderfußballmodus enthält sie keine Tore und keine Tabelle. */
export interface PublicMatch {
  id: string;
  roundNumber: number;
  teamAId: string;
  teamBId: string;
  fieldId?: string;
  waveIndex?: number;
  startISO?: string;
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
