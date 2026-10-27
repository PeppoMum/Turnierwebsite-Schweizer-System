// Fachliches Datenmodell gemäß Spezifikation §5.
// IDs sind stabile UUIDs bzw. Firestore-IDs; Teamnamen sind nie Fremdschlüssel.

export type TournamentStatus = 'draft' | 'published' | 'running' | 'finished' | 'archived';
export type Visibility = 'full' | 'no_standings' | 'kids';
export type TeamStatus = 'active' | 'no_show' | 'withdrawn' | 'inactive';
export type MatchStatus = 'draft' | 'scheduled' | 'live' | 'completed' | 'not_played' | 'cancelled';
export type RoundStatus = 'draft' | 'preview' | 'published' | 'active' | 'closed';
export type PairingMode = 'balanced' | 'strict_no_rematch' | 'performance_first';
export type TieBreaker = 'head_to_head' | 'goal_diff' | 'goals_for' | 'buchholz';
export type NotPlayedReason = 'no_show' | 'withdrawal' | 'cancellation' | 'other';
export type RoleName = 'owner' | 'results_helper' | 'extended_helper';

/**
 * Buchholz-Variante (Spezifikation §6.2 verlangt eine explizit gewählte Definition).
 * - `avg_opponent_quotient`: Durchschnitt der Quotienten aller Gegner (Standard, passt zur Quotientenwertung)
 * - `sum_opponent_quotient`: Summe der Quotienten aller Gegner
 * - `sum_opponent_points`: klassische Summe der Punkte aller Gegner
 * Gezählt werden nur gewertete Spiele; Freilose und nicht ausgetragene Spiele erzeugen keinen Gegner.
 */
export type BuchholzVariant = 'avg_opponent_quotient' | 'sum_opponent_quotient' | 'sum_opponent_points';

export interface PointsConfig {
  win: 3;
  draw: 1;
  loss: 0;
}

export interface RankingConfig {
  primary: 'points_per_played_match';
  tieBreakers: TieBreaker[];
  /** Nur relevant, wenn `buchholz` in `tieBreakers` steht. Standard: `avg_opponent_quotient`. */
  buchholzVariant?: BuchholzVariant;
}

export interface ScheduleConfig {
  tournamentStartISO: string;
  matchMinutes: number;
  turnoverMinutes: number;
  roundBreakMinutes: number;
  optionalHardRestMinutes?: number;
  /**
   * Pausen aller Teams möglichst gleich lang halten (Standard: an). `false` = nur zu kurze
   * Pausen vermeiden.
   */
  evenRest?: boolean;
  allocation: 'max_capacity' | 'balanced_waves';
}

export interface Tournament {
  id: string;
  ownerUid: string;
  title: string;
  organizerName: string;
  venue?: string;
  localDate: string;
  timeZone: string;
  organizerAssetId?: string;
  eventAssetId?: string;
  themeColor?: string;
  status: TournamentStatus;
  visibility: Visibility;
  roundsTotal: number;
  preDrawRounds: number;
  pairingMode: PairingMode;
  points: PointsConfig;
  ranking: RankingConfig;
  schedule: ScheduleConfig;
  fieldIds: string[];
  currentRound: number;
  revision: number;
  /** Geheimer Teil des Helferlinks ohne Anmeldung; fehlt/null = ausgeschaltet. */
  openHelperLinkId?: string | null;
  publishedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  id: string;
  tournamentId: string;
  name: string;
  logoAssetId?: string;
  status: TeamStatus;
  joinedAt: string;
  withdrawnAt?: string;
  externalNote?: string;
  seed?: number;
}

export interface Field {
  id: string;
  tournamentId: string;
  name: string;
  order: number;
  active: boolean;
}

export interface Sponsor {
  id: string;
  name: string;
  assetId?: string;
  url?: string;
  order: number;
}

export interface PairingDiagnostics {
  objectiveCost: number;
  repeats: number;
  tripleEncounters: number;
  meanQuotientGap: number;
  maxQuotientGap: number;
  byeTeamId?: string;
  warnings: string[];
}

export interface Round {
  id: string;
  number: number;
  status: RoundStatus;
  mode: 'draw' | 'swiss';
  plannedStartISO: string;
  actualStartISO?: string;
  generatedFromRevision: number;
  publishedAt?: string;
  closedAt?: string;
  frozenPairings: boolean;
  pairingDiagnostics?: PairingDiagnostics;
}

export interface Match {
  id: string;
  roundId: string;
  roundNumber: number;
  teamAId: string;
  teamBId: string;
  fieldId?: string;
  waveIndex?: number;
  startISO?: string;
  durationMinutes: number;
  status: MatchStatus;
  goalsA?: number;
  goalsB?: number;
  completedAt?: string;
  notPlayedReason?: NotPlayedReason;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Bye {
  id: string;
  roundId: string;
  teamId: string;
  reason: 'odd_team_count';
}

export interface RoleGrant {
  tournamentId: string;
  uid: string;
  role: RoleName;
  expiresAt?: string;
  revokedAt?: string;
}

export interface AuditLog {
  id: string;
  tournamentId: string;
  actorUid: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  timestamp: string;
  transactionId: string;
}
