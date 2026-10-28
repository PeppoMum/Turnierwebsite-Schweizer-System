// Öffentliche Projektionen (§5 „Datenaufteilung“): deterministisch aus den privaten Daten.
// Reine Funktionen ohne Firestore-Zugriff; `updatedAt` setzt der Schreibvorgang
// (serverTimestamp), weil die Regeln `updatedAt == request.time` verlangen.
import type { Visibility } from '../domain';
import type {
  FieldDoc,
  MatchDoc,
  PublicMatchDoc,
  PublicResultDoc,
  PublicRoundDoc,
  PublicStandingRow,
  PublicStandingsDoc,
  PublicTournamentDoc,
  RoundDoc,
  SponsorDoc,
  TeamDoc,
  TournamentDoc,
} from './model';

type WithoutStamp<T> = Omit<T, 'updatedAt'>;

/** Im Kindermodus gibt es öffentlich keine Ergebnisse. */
export function resultsArePublic(visibility: Visibility): boolean {
  return visibility === 'full' || visibility === 'no_standings';
}

/** Die Tabelle ist nur im Modus `full` öffentlich. */
export function standingsArePublic(visibility: Visibility): boolean {
  return visibility === 'full';
}

/** Veröffentlichte Runden-/Spielstände; Entwürfe und Vorschauen bleiben privat. */
export function isPublishedRoundStatus(status: RoundDoc['status']): status is PublicRoundDoc['status'] {
  return status === 'published' || status === 'active' || status === 'closed';
}

export function isPublishedMatchStatus(status: MatchDoc['status']): status is PublicMatchDoc['status'] {
  return status !== 'draft';
}

const byName = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

export function toPublicTournament(
  tournamentId: string,
  t: TournamentDoc,
  data: {
    teams: Array<TeamDoc & { id: string }>;
    fields: Array<FieldDoc & { id: string }>;
    sponsors: Array<SponsorDoc & { id: string }>;
    isPublic: boolean;
  },
): WithoutStamp<PublicTournamentDoc> {
  return {
    tournamentId,
    title: t.title,
    organizerName: t.organizerName,
    venue: t.venue ?? null,
    localDate: t.localDate,
    timeZone: t.timeZone,
    organizerAssetId: t.organizerAssetId ?? null,
    eventAssetId: t.eventAssetId ?? null,
    themeColor: t.themeColor ?? null,
    status: t.status,
    visibility: t.visibility,
    isPublic: data.isPublic,
    roundsTotal: t.roundsTotal,
    currentRound: t.currentRound,
    // Alphabetisch, nie nach Tabellenposition – sonst verrät die Reihenfolge im
    // Kindermodus den Tabellenstand.
    teams: data.teams
      .filter((team) => team.status !== 'inactive')
      .map((team) => ({
        id: team.id,
        name: team.name,
        logoAssetId: team.logoAssetId ?? null,
        status: team.status,
      }))
      .sort((a, b) => byName.compare(a.name, b.name) || a.id.localeCompare(b.id)),
    fields: data.fields
      .filter((f) => f.active)
      .map((f) => ({ id: f.id, name: f.name, order: f.order }))
      .sort((a, b) => a.order - b.order),
    sponsors: data.sponsors
      .map((s) => ({
        id: s.id,
        name: s.name,
        assetId: s.assetId ?? null,
        url: s.url ?? null,
        order: s.order,
      }))
      .sort((a, b) => a.order - b.order),
    timing: {
      tournamentStartISO: t.schedule.tournamentStartISO,
      matchMinutes: t.schedule.matchMinutes,
      turnoverMinutes: t.schedule.turnoverMinutes,
      roundBreakMinutes: t.schedule.roundBreakMinutes,
    },
    sourceRevision: t.revision,
  };
}

export function toPublicRound(roundId: string, r: RoundDoc): WithoutStamp<PublicRoundDoc> {
  if (!isPublishedRoundStatus(r.status)) {
    throw new Error(`Runde ${r.number} ist noch nicht freigegeben und darf nicht öffentlich werden.`);
  }
  return {
    roundId,
    number: r.number,
    mode: r.mode,
    status: r.status,
    plannedStartISO: r.plannedStartISO,
    actualStartISO: r.actualStartISO ?? null,
    byeTeamIds: [...(r.byeTeamIds ?? [])],
    publishedAt: r.publishedAt ?? null,
  };
}

/** Öffentliches Spiel: Paarung, Feld, Zeit, Status. Enthält nie Tore. */
export function toPublicMatch(matchId: string, m: MatchDoc): WithoutStamp<PublicMatchDoc> {
  if (!isPublishedMatchStatus(m.status)) {
    throw new Error('Ein Spiel im Entwurf darf nicht öffentlich werden.');
  }
  return {
    matchId,
    roundId: m.roundId,
    roundNumber: m.roundNumber,
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    fieldId: m.fieldId ?? null,
    waveIndex: m.waveIndex ?? null,
    startISO: m.startISO ?? null,
    durationMinutes: m.durationMinutes,
    status: m.status,
    sourceRevision: m.revision,
  };
}

/** Tore eines Spiels. Nur aufrufen, wenn `resultsArePublic(visibility)`. */
export function toPublicResult(matchId: string, m: MatchDoc): WithoutStamp<PublicResultDoc> {
  return {
    matchId,
    roundId: m.roundId,
    status: m.status,
    goalsA: m.goalsA ?? null,
    goalsB: m.goalsB ?? null,
    sourceRevision: m.revision,
  };
}

export function toPublicStandings(
  rows: PublicStandingRow[],
  throughRound: number,
  resultsRevision: number,
): WithoutStamp<PublicStandingsDoc> {
  return {
    rows: rows.map((r) => ({ ...r })),
    throughRound,
    resultsRevision,
  };
}
