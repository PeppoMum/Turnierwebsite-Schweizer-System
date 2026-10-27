// Ansichtsdaten der Oberfläche. Die Fachtypen kommen aus src/domain; hier nur, was die UI zusätzlich bündelt.
import type {
  Bye,
  Field,
  Match,
  NotPlayedReason,
  PairingDiagnostics,
  PairingMode,
  Round,
  Sponsor,
  Team,
  TieBreaker,
  Tournament,
  Visibility,
} from '../../domain';

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

export interface StandingRow {
  teamId: string;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  /** null bei 0 Spielen, Anzeige „–“. */
  quotient: number | null;
  byes: number;
  buchholz: number | null;
  /** Zurückgezogene Teams sind nicht wertungsberechtigt. */
  eligible: boolean;
}

export interface PairingPreview {
  roundNumber: number;
  mode: 'draw' | 'swiss';
  pairs: Array<{ teamAId: string; teamBId: string; repeat: number }>;
  byeTeamId?: string;
  diagnostics: PairingDiagnostics;
}

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

export type { NotPlayedReason };
