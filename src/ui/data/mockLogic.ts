// Vorläufige Stellvertreter für Wertung, Paarung und Zeitplan, nur damit die Oberfläche mit Beispieldaten läuft.
// Die echten, getesteten Implementierungen entstehen in src/domain (scoring, pairing, schedule) und ersetzen
// diese Funktionen. Die Paarung hier ist bewusst einfach und nicht der geforderte Min-Cost-Matching-Algorithmus.
import type { Match, Team, TieBreaker } from '../../domain';
import type { PairingPreview, PublicTournamentView, StandingRow, TournamentData } from './types';

export function isCounted(m: Match): boolean {
  return (
    m.status === 'completed' &&
    Number.isInteger(m.goalsA) &&
    Number.isInteger(m.goalsB) &&
    (m.goalsA ?? -1) >= 0 &&
    (m.goalsB ?? -1) >= 0
  );
}

/** Quote ohne Rundung vergleichen: a.points * b.played gegen b.points * a.played. */
function compareQuotient(a: StandingRow, b: StandingRow): number {
  if (a.played === 0 && b.played === 0) return 0;
  if (a.played === 0) return 1;
  if (b.played === 0) return -1;
  return b.points * a.played - a.points * b.played;
}

export function computeStandings(data: TournamentData): StandingRow[] {
  const { teams, matches, byes, tournament } = data;
  // Rückzug: alle Spiele eines zurückgezogenen Teams fallen für alle aus der Wertung (Projektentscheidung).
  const withdrawn = new Set(teams.filter((t) => t.status === 'withdrawn').map((t) => t.id));
  const counted = matches.filter((m) => isCounted(m) && !withdrawn.has(m.teamAId) && !withdrawn.has(m.teamBId));

  const rows = new Map<string, StandingRow>();
  for (const t of teams) {
    if (t.status === 'inactive') continue;
    rows.set(t.id, {
      teamId: t.id,
      rank: 0,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
      quotient: null,
      byes: byes.filter((b) => b.teamId === t.id).length,
      buchholz: null,
      eligible: t.status !== 'withdrawn',
    });
  }
  const opponents = new Map<string, string[]>();
  for (const m of counted) {
    const a = rows.get(m.teamAId);
    const b = rows.get(m.teamBId);
    if (!a || !b) continue;
    const ga = m.goalsA!;
    const gb = m.goalsB!;
    a.played++;
    b.played++;
    a.goalsFor += ga;
    a.goalsAgainst += gb;
    b.goalsFor += gb;
    b.goalsAgainst += ga;
    if (ga > gb) {
      a.wins++;
      b.losses++;
    } else if (ga < gb) {
      b.wins++;
      a.losses++;
    } else {
      a.draws++;
      b.draws++;
    }
    opponents.set(a.teamId, [...(opponents.get(a.teamId) ?? []), b.teamId]);
    opponents.set(b.teamId, [...(opponents.get(b.teamId) ?? []), a.teamId]);
  }
  for (const r of rows.values()) {
    r.points = r.wins * 3 + r.draws;
    r.goalDiff = r.goalsFor - r.goalsAgainst;
    r.quotient = r.played === 0 ? null : r.points / r.played;
  }
  const buchholzOn = tournament.ranking.tieBreakers.includes('buchholz');
  if (buchholzOn) {
    for (const r of rows.values()) {
      r.buchholz = (opponents.get(r.teamId) ?? []).reduce((s, id) => s + (rows.get(id)?.points ?? 0), 0);
    }
  }

  const headToHead = (a: StandingRow, b: StandingRow): number => {
    let pa = 0;
    let pb = 0;
    for (const m of counted) {
      if (m.teamAId === a.teamId && m.teamBId === b.teamId) {
        pa += m.goalsA! > m.goalsB! ? 3 : m.goalsA === m.goalsB ? 1 : 0;
        pb += m.goalsB! > m.goalsA! ? 3 : m.goalsA === m.goalsB ? 1 : 0;
      } else if (m.teamAId === b.teamId && m.teamBId === a.teamId) {
        pb += m.goalsA! > m.goalsB! ? 3 : m.goalsA === m.goalsB ? 1 : 0;
        pa += m.goalsB! > m.goalsA! ? 3 : m.goalsA === m.goalsB ? 1 : 0;
      }
    }
    return pb - pa;
  };
  const byCriterion: Record<TieBreaker, (a: StandingRow, b: StandingRow) => number> = {
    head_to_head: headToHead,
    goal_diff: (a, b) => b.goalDiff - a.goalDiff,
    goals_for: (a, b) => b.goalsFor - a.goalsFor,
    buchholz: (a, b) => (b.buchholz ?? 0) - (a.buchholz ?? 0),
  };
  const names = new Map(teams.map((t) => [t.id, t.name]));
  const sorted = [...rows.values()].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const q = compareQuotient(a, b);
    if (q !== 0) return q;
    for (const tb of tournament.ranking.tieBreakers) {
      const c = byCriterion[tb](a, b);
      if (c !== 0) return c;
    }
    return (names.get(a.teamId) ?? '').localeCompare(names.get(b.teamId) ?? '', 'de');
  });
  sorted.forEach((r, i) => (r.rank = i + 1));
  return sorted;
}

export function pastMeetings(matches: Match[], a: string, b: string): number {
  return matches.filter(
    (m) => m.status !== 'cancelled' && ((m.teamAId === a && m.teamBId === b) || (m.teamAId === b && m.teamBId === a)),
  ).length;
}

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function activeTeams(teams: Team[]): Team[] {
  return teams.filter((t) => t.status === 'active');
}

/** Stellvertreter: nach Tabelle sortieren und benachbarte Teams paaren, Wiederholungen nach Möglichkeit tauschen. */
export function previewNextRound(data: TournamentData, seed = Date.now()): PairingPreview {
  const roundNumber = Math.max(0, ...data.rounds.map((r) => r.number)) + 1;
  const mode = roundNumber <= data.tournament.preDrawRounds ? 'draw' : 'swiss';
  const active = new Set(activeTeams(data.teams).map((t) => t.id));
  let order: string[];
  if (mode === 'draw') {
    const rand = mulberry32(seed);
    order = [...active].sort(() => rand() - 0.5);
  } else {
    order = computeStandings(data)
      .filter((r) => active.has(r.teamId))
      .map((r) => r.teamId);
  }
  let byeTeamId: string | undefined;
  if (order.length % 2 === 1) {
    const byeCount = (id: string) => data.byes.filter((b) => b.teamId === id).length;
    const minBye = Math.min(...order.map(byeCount));
    byeTeamId = [...order].reverse().find((id) => byeCount(id) === minBye);
    order = order.filter((id) => id !== byeTeamId);
  }
  const pairs: PairingPreview['pairs'] = [];
  const pool = [...order];
  while (pool.length >= 2) {
    const a = pool.shift()!;
    let idx = pool.findIndex((b, i) => i < 3 && pastMeetings(data.matches, a, b) === 0);
    if (idx < 0) idx = 0;
    const b = pool.splice(idx, 1)[0]!;
    pairs.push({ teamAId: a, teamBId: b, repeat: pastMeetings(data.matches, a, b) });
  }
  const standings = computeStandings(data);
  const q = new Map(standings.map((r) => [r.teamId, r.quotient ?? 1.5]));
  const gaps = pairs.map((p) => Math.abs((q.get(p.teamAId) ?? 0) - (q.get(p.teamBId) ?? 0)));
  const repeats = pairs.filter((p) => p.repeat > 0).length;
  const warnings: string[] = [];
  if (repeats > 0) warnings.push(`${repeats} ${repeats === 1 ? 'Paarung ist eine Wiederholung' : 'Paarungen sind Wiederholungen'}.`);
  return {
    roundNumber,
    mode,
    pairs,
    byeTeamId,
    diagnostics: {
      objectiveCost: 0,
      repeats,
      tripleEncounters: pairs.filter((p) => p.repeat >= 2).length,
      meanQuotientGap: gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0,
      maxQuotientGap: gaps.length ? Math.max(...gaps) : 0,
      byeTeamId,
      warnings,
    },
  };
}

/** Stellvertreter für die Wellenplanung: Spiele der Reihe nach auf Felder verteilen. */
export function planWaves(
  pairCount: number,
  fieldIds: string[],
  startISO: string,
  matchMinutes: number,
  turnoverMinutes: number,
  allocation: 'max_capacity' | 'balanced_waves',
): Array<{ fieldId: string; waveIndex: number; startISO: string }> {
  const fieldCount = Math.max(1, fieldIds.length);
  const waves = Math.ceil(pairCount / fieldCount);
  const perWave = allocation === 'balanced_waves' ? Math.ceil(pairCount / Math.max(1, waves)) : fieldCount;
  const start = new Date(startISO).getTime();
  const out: Array<{ fieldId: string; waveIndex: number; startISO: string }> = [];
  for (let i = 0; i < pairCount; i++) {
    const waveIndex = Math.floor(i / perWave);
    const fieldId = fieldIds[i % perWave] ?? fieldIds[0] ?? '';
    out.push({
      fieldId,
      waveIndex,
      startISO: new Date(start + waveIndex * (matchMinutes + turnoverMinutes) * 60000).toISOString(),
    });
  }
  return out;
}

export function wavesPerRound(teamCount: number, fieldCount: number): number {
  return Math.ceil(Math.floor(teamCount / 2) / Math.max(1, fieldCount));
}

export function roundMinutes(teamCount: number, fieldCount: number, matchMinutes: number, turnoverMinutes: number): number {
  const w = wavesPerRound(teamCount, fieldCount);
  return w * matchMinutes + Math.max(0, w - 1) * turnoverMinutes;
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
