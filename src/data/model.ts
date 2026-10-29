// Firestore-Dokumentformen. Sie ergänzen die Domänentypen (src/domain/types.ts) um
// Felder, die nur für Persistenz, Rechte und Konsistenz gebraucht werden.
// Zeitstempel liegen in Firestore als Timestamp vor; die Domäne arbeitet mit ISO-Strings.
import type { Timestamp } from 'firebase/firestore';
import type {
  Bye,
  Field,
  Match,
  MatchStatus,
  NotPlayedReason,
  RoleName,
  Round,
  RoundStatus,
  Sponsor,
  Team,
  TeamStatus,
  Tournament,
  TournamentStatus,
  Visibility,
} from '../domain';
import type { TeamStanding } from '../domain/scoring';
import type { DrawMode, StageMatchFields, TournamentFormat } from '../domain/format';

/** Felder, die als Firestore-Timestamp gespeichert werden. */
type Stamped<T, K extends keyof T> = Omit<T, K> & { [P in K]: Timestamp };

export type TournamentDoc = Stamped<
  Omit<Tournament, 'id' | 'publishedAt' | 'finishedAt'>,
  'createdAt' | 'updatedAt'
> & {
  /** Wird bei jeder ergebnisrelevanten Spieländerung um 1 erhöht (Basis für `generatedFromRevision`). */
  resultsRevision: number;
  publishedAt?: Timestamp | null;
  finishedAt?: Timestamp | null;
};

export type TeamDoc = Omit<Team, 'id'>;
export type FieldDoc = Omit<Field, 'id'>;
export type SponsorDoc = Omit<Sponsor, 'id'>;
export type ByeDoc = Omit<Bye, 'id'>;

export type MatchDoc = Stamped<Omit<Match, 'id' | 'completedAt'>, 'createdAt' | 'updatedAt'> & {
  completedAt?: Timestamp | null;
  goalsA?: number | null;
  goalsB?: number | null;
  notPlayedReason?: NotPlayedReason | null;
  decidedBy?: StageMatchFields['decidedBy'] | null;
  penaltiesA?: number | null;
  penaltiesB?: number | null;
  walkoverWinner?: StageMatchFields['walkoverWinner'] | null;
  /** Verweis auf den Audit-Eintrag der letzten Änderung (von den Regeln geprüft). */
  lastAuditId?: string;
  updatedBy?: string;
};

export type RoundDoc = Omit<Round, 'id' | 'publishedAt' | 'closedAt'> & {
  /** Spiele dieser Runde, damit Transaktionen sie ohne Query lesen können. */
  matchIds: string[];
  /** Teams mit Freilos in dieser Runde (Bye-Dokumente heißen `${roundId}_${teamId}`). */
  byeTeamIds: string[];
  publishedAt?: Timestamp | null;
  closedAt?: Timestamp | null;
  updatedAt: Timestamp;
};

export interface RoleGrantDoc {
  uid: string;
  tournamentId: string;
  role: RoleName;
  expiresAt?: Timestamp | null;
  revokedAt?: Timestamp | null;
  /** Ergebnis-Helfer nur für bestimmte Felder; fehlt/null = alle Felder. */
  allowedFieldIds?: string[] | null;
  /** Nur für extended_helper: darf Runden freigeben. */
  canPublishRounds?: boolean;
  inviteId?: string;
  /** Rolle stammt aus dem Helferlink ohne Anmeldung; gilt nur, solange das Turnier diesen Link hat. */
  openLinkId?: string;
  email?: string | null;
  createdAt: Timestamp;
  createdBy: string;
}

export interface InvitationDoc {
  tournamentId: string;
  tournamentTitle: string;
  role: RoleName;
  allowedFieldIds?: string[] | null;
  canPublishRounds?: boolean;
  /** Ablauf des daraus entstehenden Grants (optional, z. B. Turnierende). */
  grantExpiresAt?: Timestamp | null;
  /** Ablauf der Einladung selbst (max. 30 Tage). */
  expiresAt: Timestamp;
  createdAt: Timestamp;
  createdBy: string;
  usedBy?: string | null;
  usedAt?: Timestamp | null;
  revokedAt?: Timestamp | null;
}

export interface AuditDoc {
  tournamentId: string;
  actorUid: string;
  action: string;
  targetType: 'tournament' | 'match' | 'round' | 'team' | 'grant' | 'invitation' | 'visibility' | 'stage';
  targetId: string;
  before?: unknown;
  after?: unknown;
  timestamp: Timestamp;
  transactionId: string;
}

/** Firestore kennt keine Listen in Listen: Gruppen und Lostöpfe als Liste von `{ teamIds }`. */
export interface TeamIdList {
  teamIds: string[];
}

/** Ein gezogenes Los (siehe LotDecision in src/ui/data/types.ts). */
export interface LotDoc {
  id: string;
  groupIndex?: number | null;
  place?: number | null;
  order: string[];
  atISO: string;
}

/** Baukasten: Gruppeneinteilung und Lose eines Abschnitts, `tournaments/{tid}/stages/{stageId}`. */
export interface StageDoc {
  stageId: string;
  groups?: TeamIdList[] | null;
  mode?: DrawMode | null;
  pots?: TeamIdList[] | null;
  seed?: number | null;
  lots?: LotDoc[];
  updatedAt: Timestamp;
}

export interface TournamentRefDoc {
  tournamentId: string;
  role: RoleName;
  addedAt: Timestamp;
}

export type AssetKind = 'organizer' | 'event' | 'team' | 'sponsor';
export type AssetMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface AssetDoc {
  dataUrl: string;
  mimeType: AssetMimeType;
  bytes: number;
  width: number;
  height: number;
  kind: AssetKind;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------- Öffentliche Projektion ----------

export interface PublicTeam {
  id: string;
  name: string;
  logoAssetId: string | null;
  status: TeamStatus;
}

export interface PublicField {
  id: string;
  name: string;
  order: number;
}

export interface PublicSponsor {
  id: string;
  name: string;
  assetId: string | null;
  url: string | null;
  order: number;
}

export interface PublicTournamentDoc {
  tournamentId: string;
  title: string;
  organizerName: string;
  venue: string | null;
  localDate: string;
  timeZone: string;
  organizerAssetId: string | null;
  eventAssetId: string | null;
  themeColor: string | null;
  status: TournamentStatus;
  visibility: Visibility;
  isPublic: boolean;
  roundsTotal: number;
  currentRound: number;
  /** Alphabetisch sortiert – nie nach Tabellenplatz (Kindermodus, §12 B). */
  teams: PublicTeam[];
  fields: PublicField[];
  sponsors: PublicSponsor[];
  /**
   * Zeitwerte für die ungefähren Startzeiten aller Runden. Fehlt bei Projektionen, die vor
   * dieser Erweiterung oder unter älteren Schutzregeln geschrieben wurden.
   */
  timing?: PublicTiming | null;
  /** Baukasten: Ablauf des Turniers. Fehlt bei Schweizer-System-Turnieren. */
  format?: TournamentFormat | null;
  sourceRevision: number;
  updatedAt: Timestamp;
}

export interface PublicTiming {
  tournamentStartISO: string;
  matchMinutes: number;
  turnoverMinutes: number;
  roundBreakMinutes: number;
}

export interface PublicRoundDoc {
  roundId: string;
  number: number;
  mode: Round['mode'];
  status: Extract<RoundStatus, 'published' | 'active' | 'closed'>;
  plannedStartISO: string;
  actualStartISO: string | null;
  /** Freilose dieser Runde (Teams haben in der Runde spielfrei). */
  byeTeamIds: string[];
  publishedAt: Timestamp | null;
  updatedAt: Timestamp;
}

/** Öffentliches Spiel ohne Tore – in allen Sichtbarkeitsmodi identisch. */
export interface PublicMatchDoc {
  matchId: string;
  roundId: string;
  roundNumber: number;
  teamAId: string;
  teamBId: string;
  fieldId: string | null;
  waveIndex: number | null;
  startISO: string | null;
  durationMinutes: number;
  status: Exclude<MatchStatus, 'draft'>;
  // Baukasten-Felder; fehlen bei Schweizer-System-Spielen. Nie Tore oder Neunmeter-Treffer.
  stageId?: string;
  groupIndex?: number | null;
  matchKey?: string | null;
  slotA?: StageMatchFields['slotA'] | null;
  slotB?: StageMatchFields['slotB'] | null;
  penaltyOnly?: boolean | null;
  decidedBy?: StageMatchFields['decidedBy'] | null;
  walkoverWinner?: StageMatchFields['walkoverWinner'] | null;
  sourceRevision: number;
  updatedAt: Timestamp;
}

/** Tore eines Spiels – nur in `full` und `no_standings` vorhanden und lesbar. */
export interface PublicResultDoc {
  matchId: string;
  roundId: string;
  status: MatchStatus;
  goalsA: number | null;
  goalsB: number | null;
  /** Nur bei Endrunden-Spielen mit Neunmeterschießen. */
  penaltiesA?: number | null;
  penaltiesB?: number | null;
  sourceRevision: number;
  updatedAt: Timestamp;
}

/** Tabellenzeile wie von der Wertung berechnet (src/domain/scoring). */
export type PublicStandingRow = TeamStanding;

/** Tabelle – nur im Modus `full`, ein Dokument `publicStandings/current`. */
export interface PublicStandingsDoc {
  rows: PublicStandingRow[];
  throughRound: number;
  resultsRevision: number;
  updatedAt: Timestamp;
}

export const PUBLIC_STANDINGS_DOC_ID = 'current';

/** Baukasten öffentlich: Gruppeneinteilung, Lose nur im Modus `full`. */
export interface PublicStageDoc {
  stageId: string;
  groups: TeamIdList[];
  lots?: LotDoc[];
  updatedAt: Timestamp;
}
