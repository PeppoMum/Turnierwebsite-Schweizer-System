// Brücke zwischen Oberfläche und Fachlogik in src/domain: Tabelle, Paarung und Zeitplan
// kommen aus den getesteten Domain-Modulen, hier wird nur zusammengesteckt.
import type { Match } from '../../domain';
import { calculateStandings } from '../../domain/scoring';
import { previewNextRound as domainPreviewNextRound } from '../../domain/pairing';
import type { PairingPreview, PublicTournamentView, StandingRow, TournamentData } from './types';

export { planWaves, roundMinutes, wavesPerRound } from '../../domain/schedule';

export function isCounted(m: Match): boolean {
  return (
    m.status === 'completed' &&
    Number.isInteger(m.goalsA) &&
    Number.isInteger(m.goalsB) &&
    (m.goalsA ?? -1) >= 0 &&
    (m.goalsB ?? -1) >= 0
  );
}

export function computeStandings(data: TournamentData): StandingRow[] {
  const { tournament: t } = data;
  return calculateStandings({
    teams: data.teams,
    matches: data.matches,
    byes: data.byes,
    rounds: data.rounds,
    tieBreakers: t.ranking.tieBreakers,
    buchholzVariant: t.ranking.buchholzVariant,
    lotSeed: t.id,
  });
}

export function previewNextRound(data: TournamentData, seed: string | number = Date.now()): PairingPreview {
  return domainPreviewNextRound(
    {
      tournament: data.tournament,
      teams: data.teams,
      matches: data.matches,
      byes: data.byes,
      rounds: data.rounds,
      standings: computeStandings(data),
    },
    seed,
  );
}

/**
 * Öffentliche Projektion, wie sie später als eigenes Firestore-Dokument veröffentlicht wird.
 * Im Kinderfußballmodus werden Tore und Tabelle gar nicht erst übernommen.
 */
export function toPublicView(data: TournamentData): PublicTournamentView {
  const { tournament: t } = data;
  const showScores = t.visibility !== 'kids';
  const showTable = t.visibility === 'full';
  const publishedRounds = data.rounds.filter((r) => r.status === 'published' || r.status === 'active' || r.status === 'closed');
  const roundNumbers = new Set(publishedRounds.map((r) => r.number));
  const roundIdToNumber = new Map(data.rounds.map((r) => [r.id, r.number]));
  return {
    tournament: {
      id: t.id,
      title: t.title,
      organizerName: t.organizerName,
      venue: t.venue,
      localDate: t.localDate,
      timeZone: t.timeZone,
      status: t.status,
      visibility: t.visibility,
      roundsTotal: t.roundsTotal,
      currentRound: t.currentRound,
    },
    organizerLogo: t.organizerAssetId ? data.assets[t.organizerAssetId] : undefined,
    eventLogo: t.eventAssetId ? data.assets[t.eventAssetId] : undefined,
    teams: data.teams
      .filter((tm) => tm.status !== 'inactive')
      .map((tm) => ({ id: tm.id, name: tm.name, status: tm.status, logo: tm.logoAssetId ? data.assets[tm.logoAssetId] : undefined })),
    fields: data.fields.map((f) => ({ id: f.id, name: f.name, order: f.order })),
    sponsors: data.sponsors.map((s) => ({ id: s.id, name: s.name, url: s.url, logo: s.assetId ? data.assets[s.assetId] : undefined })),
    rounds: publishedRounds.map((r) => ({ number: r.number, plannedStartISO: r.plannedStartISO, status: r.status })),
    matches: data.matches
      .filter((m) => roundNumbers.has(m.roundNumber))
      .map((m) => ({
        id: m.id,
        roundNumber: m.roundNumber,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        fieldId: m.fieldId,
        waveIndex: m.waveIndex,
        startISO: m.startISO,
        status: m.status,
        ...(showScores && isCounted(m) ? { goalsA: m.goalsA, goalsB: m.goalsB } : {}),
        ...(showScores && m.status === 'live' ? { goalsA: m.goalsA ?? 0, goalsB: m.goalsB ?? 0 } : {}),
      })),
    byes: data.byes
      .map((b) => ({ roundNumber: roundIdToNumber.get(b.roundId) ?? 0, teamId: b.teamId }))
      .filter((b) => roundNumbers.has(b.roundNumber)),
    ...(showTable ? { standings: computeStandings(data) } : {}),
    updatedAt: t.updatedAt,
  };
}
