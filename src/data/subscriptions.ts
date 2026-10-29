// Live-Abos (onSnapshot) für Gäste und Turnierleitung (§2.1 Live-Synchronisierung, §10.3).
// Gäste abonnieren ausschließlich öffentliche Projektionen; private Daten sind für sie
// durch die Regeln gesperrt. Listener sparsam halten: wenn möglich auf eine Runde filtern.
import {
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QueryConstraint,
} from 'firebase/firestore';
import type { Match, Round, Tournament } from '../domain';
import { toDataError, type DataError } from './errors';
import { toMatch, toRound, toTournament } from './mappers';
import type {
  AssetDoc,
  ByeDoc,
  FieldDoc,
  PublicMatchDoc,
  PublicResultDoc,
  PublicRoundDoc,
  PublicStageDoc,
  PublicStandingsDoc,
  PublicTournamentDoc,
  RoleGrantDoc,
  SponsorDoc,
  StageDoc,
  TeamDoc,
  TournamentRefDoc,
} from './model';
import { paths } from './paths';

/** Snapshot-Metadaten für „Stand: …“-/Offline-Anzeigen (§4.4, §10.3). */
export interface LiveMeta {
  fromCache: boolean;
  hasPendingWrites: boolean;
  receivedAt: Date;
}

export type Unsubscribe = () => void;
export type OnError = (error: DataError) => void;
export type WithId<T> = T & { id: string };

function meta(snap: { metadata: { fromCache: boolean; hasPendingWrites: boolean } }): LiveMeta {
  return {
    fromCache: snap.metadata.fromCache,
    hasPendingWrites: snap.metadata.hasPendingWrites,
    receivedAt: new Date(),
  };
}

export function subscribeDoc<T, R = T>(
  ref: DocumentReference<T>,
  onData: (data: R | null, meta: LiveMeta) => void,
  onError?: OnError,
  map: (id: string, data: T) => R = (_id, d) => d as unknown as R,
): Unsubscribe {
  return onSnapshot(
    ref,
    { includeMetadataChanges: true },
    (snap: DocumentSnapshot<T>) => onData(snap.exists() ? map(snap.id, snap.data()) : null, meta(snap)),
    (err) => onError?.(toDataError(err)),
  );
}

export function subscribeQuery<T, R = WithId<T>>(
  q: Query<T>,
  onData: (items: R[], meta: LiveMeta) => void,
  onError?: OnError,
  map: (id: string, data: T) => R = (id, d) => ({ ...d, id }) as unknown as R,
): Unsubscribe {
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => onData(snap.docs.map((d) => map(d.id, d.data())), meta(snap)),
    (err) => onError?.(toDataError(err)),
  );
}

const roundFilter = (roundId?: string): QueryConstraint[] =>
  roundId ? [where('roundId', '==', roundId)] : [];

// ---------- Öffentlich (Gäste) ----------

export const subscribePublicTournament = (
  db: Firestore,
  tid: string,
  onData: (t: PublicTournamentDoc | null, m: LiveMeta) => void,
  onError?: OnError,
) => subscribeDoc(paths.publicTournament(db, tid), onData, onError);

export const subscribePublicRounds = (
  db: Firestore,
  tid: string,
  onData: (rounds: WithId<PublicRoundDoc>[], m: LiveMeta) => void,
  onError?: OnError,
) => subscribeQuery(query(paths.publicRounds(db, tid), orderBy('number')), onData, onError);

export const subscribePublicMatches = (
  db: Firestore,
  tid: string,
  onData: (matches: WithId<PublicMatchDoc>[], m: LiveMeta) => void,
  onError?: OnError,
  options: { roundId?: string } = {},
) => subscribeQuery(query(paths.publicMatches(db, tid), ...roundFilter(options.roundId)), onData, onError);

/** Nur in `full`/`no_standings` erlaubt; im Kindermodus liefert Firestore permission-denied. */
export const subscribePublicResults = (
  db: Firestore,
  tid: string,
  onData: (results: WithId<PublicResultDoc>[], m: LiveMeta) => void,
  onError?: OnError,
  options: { roundId?: string } = {},
) => subscribeQuery(query(paths.publicResults(db, tid), ...roundFilter(options.roundId)), onData, onError);

/** Nur im Modus `full` erlaubt. */
export const subscribePublicStandings = (
  db: Firestore,
  tid: string,
  onData: (standings: PublicStandingsDoc | null, m: LiveMeta) => void,
  onError?: OnError,
) => subscribeDoc(paths.publicStandings(db, tid), onData, onError);

/** Baukasten: Gruppeneinteilung (und im Modus `full` die Lose). */
export const subscribePublicStages = (
  db: Firestore,
  tid: string,
  onData: (stages: WithId<PublicStageDoc>[], m: LiveMeta) => void,
  onError?: OnError,
) => subscribeQuery(paths.publicStages(db, tid), onData, onError);

export const subscribePublicAsset = (
  db: Firestore,
  tid: string,
  assetId: string,
  onData: (asset: AssetDoc | null, m: LiveMeta) => void,
  onError?: OnError,
) => subscribeDoc(paths.publicAsset(db, tid, assetId), onData, onError);

// ---------- Intern (Owner/Helfer) ----------

export const subscribeTournament = (
  db: Firestore,
  tid: string,
  onData: (t: (Tournament & { resultsRevision: number }) | null, m: LiveMeta) => void,
  onError?: OnError,
) => subscribeDoc(paths.tournament(db, tid), onData, onError, toTournament);

export const subscribeMatches = (
  db: Firestore,
  tid: string,
  onData: (matches: Match[], m: LiveMeta) => void,
  onError?: OnError,
  options: { roundId?: string } = {},
) =>
  subscribeQuery(
    query(paths.matches(db, tid), ...roundFilter(options.roundId)),
    onData,
    onError,
    toMatch,
  );

export const subscribeRounds = (
  db: Firestore,
  tid: string,
  onData: (rounds: Array<Round & { matchIds: string[] }>, m: LiveMeta) => void,
  onError?: OnError,
) => subscribeQuery(query(paths.rounds(db, tid), orderBy('number')), onData, onError, toRound);

export const subscribeTeams = (
  db: Firestore,
  tid: string,
  onData: (teams: WithId<TeamDoc>[], m: LiveMeta) => void,
  onError?: OnError,
) => subscribeQuery(paths.teams(db, tid), onData, onError);

export const subscribeFields = (
  db: Firestore,
  tid: string,
  onData: (fields: WithId<FieldDoc>[], m: LiveMeta) => void,
  onError?: OnError,
) => subscribeQuery(query(paths.fields(db, tid), orderBy('order')), onData, onError);

export const subscribeSponsors = (
  db: Firestore,
  tid: string,
  onData: (sponsors: WithId<SponsorDoc>[], m: LiveMeta) => void,
  onError?: OnError,
) => subscribeQuery(query(paths.sponsors(db, tid), orderBy('order')), onData, onError);

/** Baukasten: Gruppeneinteilung und Lose je Abschnitt. */
export const subscribeStages = (
  db: Firestore,
  tid: string,
  onData: (stages: WithId<StageDoc>[], m: LiveMeta) => void,
  onError?: OnError,
) => subscribeQuery(paths.stages(db, tid), onData, onError);

export const subscribeByes = (
  db: Firestore,
  tid: string,
  onData: (byes: WithId<ByeDoc>[], m: LiveMeta) => void,
  onError?: OnError,
) => subscribeQuery(paths.byes(db, tid), onData, onError);

/** Eigene Rolle im Turnier (auch wenn widerrufen, damit die UI das anzeigen kann). */
export const subscribeMyGrant = (
  db: Firestore,
  tid: string,
  uid: string,
  onData: (grant: RoleGrantDoc | null, m: LiveMeta) => void,
  onError?: OnError,
) => subscribeDoc(paths.roleGrant(db, tid, uid), onData, onError);

/** Alle Rollen eines Turniers (nur Owner). */
export const subscribeGrants = (
  db: Firestore,
  tid: string,
  onData: (grants: WithId<RoleGrantDoc>[], m: LiveMeta) => void,
  onError?: OnError,
) => subscribeQuery(paths.roleGrants(db, tid), onData, onError);

/** Dashboard: Turniere, an denen das Konto beteiligt ist. */
export const subscribeMyTournamentRefs = (
  db: Firestore,
  uid: string,
  onData: (refs: WithId<TournamentRefDoc>[], m: LiveMeta) => void,
  onError?: OnError,
) => subscribeQuery(paths.tournamentRefs(db, uid), onData, onError);
