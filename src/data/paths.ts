// Collection-Layout (Spezifikation §5). Einzige Stelle, an der Pfade als Strings stehen.
//
// tournaments/{tid}                         privat, nur Mitglieder
//   teams|fields|sponsors|byes|rounds|matches/{id}
//   audit/{auditId}                         unveränderlich
//   roleGrants/{uid}                        Rolle je uid + Turnier
//   invitations/{inviteId}                  Helfer-Einladungen
//   assets/{assetId}                        kleine Bilder (Data-URL)
// publicTournaments/{tid}                   öffentliche Projektion
//   publicRounds|publicMatches/{id}         ohne Tore
//   publicResults/{matchId}                 Tore; nicht im Kindermodus
//   publicStandings/current                 Tabelle; nur im Modus `full`
//   publicAssets/{assetId}
// users/{uid}/tournamentRefs/{tid}          Dashboard-Zuordnung
import {
  collection,
  doc,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import {
  PUBLIC_STANDINGS_DOC_ID,
  type AssetDoc,
  type AuditDoc,
  type ByeDoc,
  type FieldDoc,
  type InvitationDoc,
  type MatchDoc,
  type PublicMatchDoc,
  type PublicResultDoc,
  type PublicRoundDoc,
  type PublicStandingsDoc,
  type PublicTournamentDoc,
  type RoleGrantDoc,
  type RoundDoc,
  type SponsorDoc,
  type TeamDoc,
  type TournamentDoc,
  type TournamentRefDoc,
} from './model';

type Col<T> = CollectionReference<T>;
type Ref<T> = DocumentReference<T>;

const col = <T>(db: Firestore, path: string) => collection(db, path) as Col<T>;
const ref = <T>(db: Firestore, path: string) => doc(db, path) as Ref<T>;

export const paths = {
  tournaments: (db: Firestore) => col<TournamentDoc>(db, 'tournaments'),
  tournament: (db: Firestore, tid: string) => ref<TournamentDoc>(db, `tournaments/${tid}`),
  teams: (db: Firestore, tid: string) => col<TeamDoc>(db, `tournaments/${tid}/teams`),
  fields: (db: Firestore, tid: string) => col<FieldDoc>(db, `tournaments/${tid}/fields`),
  sponsors: (db: Firestore, tid: string) => col<SponsorDoc>(db, `tournaments/${tid}/sponsors`),
  byes: (db: Firestore, tid: string) => col<ByeDoc>(db, `tournaments/${tid}/byes`),
  rounds: (db: Firestore, tid: string) => col<RoundDoc>(db, `tournaments/${tid}/rounds`),
  round: (db: Firestore, tid: string, roundId: string) =>
    ref<RoundDoc>(db, `tournaments/${tid}/rounds/${roundId}`),
  matches: (db: Firestore, tid: string) => col<MatchDoc>(db, `tournaments/${tid}/matches`),
  match: (db: Firestore, tid: string, matchId: string) =>
    ref<MatchDoc>(db, `tournaments/${tid}/matches/${matchId}`),
  audit: (db: Firestore, tid: string) => col<AuditDoc>(db, `tournaments/${tid}/audit`),
  roleGrants: (db: Firestore, tid: string) => col<RoleGrantDoc>(db, `tournaments/${tid}/roleGrants`),
  roleGrant: (db: Firestore, tid: string, uid: string) =>
    ref<RoleGrantDoc>(db, `tournaments/${tid}/roleGrants/${uid}`),
  invitations: (db: Firestore, tid: string) =>
    col<InvitationDoc>(db, `tournaments/${tid}/invitations`),
  invitation: (db: Firestore, tid: string, inviteId: string) =>
    ref<InvitationDoc>(db, `tournaments/${tid}/invitations/${inviteId}`),
  assets: (db: Firestore, tid: string) => col<AssetDoc>(db, `tournaments/${tid}/assets`),
  asset: (db: Firestore, tid: string, assetId: string) =>
    ref<AssetDoc>(db, `tournaments/${tid}/assets/${assetId}`),

  publicTournament: (db: Firestore, tid: string) =>
    ref<PublicTournamentDoc>(db, `publicTournaments/${tid}`),
  publicRounds: (db: Firestore, tid: string) =>
    col<PublicRoundDoc>(db, `publicTournaments/${tid}/publicRounds`),
  publicRound: (db: Firestore, tid: string, roundId: string) =>
    ref<PublicRoundDoc>(db, `publicTournaments/${tid}/publicRounds/${roundId}`),
  publicMatches: (db: Firestore, tid: string) =>
    col<PublicMatchDoc>(db, `publicTournaments/${tid}/publicMatches`),
  publicMatch: (db: Firestore, tid: string, matchId: string) =>
    ref<PublicMatchDoc>(db, `publicTournaments/${tid}/publicMatches/${matchId}`),
  publicResults: (db: Firestore, tid: string) =>
    col<PublicResultDoc>(db, `publicTournaments/${tid}/publicResults`),
  publicResult: (db: Firestore, tid: string, matchId: string) =>
    ref<PublicResultDoc>(db, `publicTournaments/${tid}/publicResults/${matchId}`),
  publicStandings: (db: Firestore, tid: string) =>
    ref<PublicStandingsDoc>(
      db,
      `publicTournaments/${tid}/publicStandings/${PUBLIC_STANDINGS_DOC_ID}`,
    ),
  publicAssets: (db: Firestore, tid: string) =>
    col<AssetDoc>(db, `publicTournaments/${tid}/publicAssets`),
  publicAsset: (db: Firestore, tid: string, assetId: string) =>
    ref<AssetDoc>(db, `publicTournaments/${tid}/publicAssets/${assetId}`),

  tournamentRefs: (db: Firestore, uid: string) =>
    col<TournamentRefDoc>(db, `users/${uid}/tournamentRefs`),
  tournamentRef: (db: Firestore, uid: string, tid: string) =>
    ref<TournamentRefDoc>(db, `users/${uid}/tournamentRefs/${tid}`),
};
