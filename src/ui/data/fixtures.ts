// Beispieldaten für die Oberfläche, bis Firestore angebunden ist.
import type { Bye, Field, Match, Round, Team, Tournament } from '../../domain';
import { planWaves } from './logic';
import { FORMAT_TEMPLATES, type PlacementStage, type SlotRef } from '../../domain/format';

/** Kleiner Zufallsgenerator, damit die Beispieldaten bei jedem Start gleich aussehen. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
import type { TournamentData } from './types';

const TEAM_NAMES = [
  'SV Blau-Weiß Nord',
  'FC Hafenkante',
  'TSV Lindenhof',
  'SpVgg Mühlbach',
  'VfL Eichenau',
  'SC Rotbach',
  'FC Sonnenberg',
  'TuS Altstadt',
  'SV Kiesgrube',
  'FC Weidenhof',
  'SG Brückenfeld',
  'TSG Waldrand',
  'VfB Seeblick',
  'FC Grünwiese',
  'SV Bergkamp',
  'SC Am Deich',
];

const KIDS_NAMES = [
  'Mini-Kicker Nord',
  'Die Flitzer',
  'Ballzauberer',
  'Kleine Löwen',
  'Torjäger Süd',
  'Blitzbälle',
  'Rasenzwerge',
  'Fußballfüchse',
  'Sternschnuppen',
];

function iso(d: Date): string {
  return d.toISOString();
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function baseTournament(id: string, patch: Partial<Tournament>): Tournament {
  const now = iso(new Date());
  return {
    id,
    ownerUid: 'demo-admin',
    title: '',
    organizerName: '',
    localDate: todayLocal(),
    timeZone: 'Europe/Berlin',
    status: 'draft',
    visibility: 'full',
    roundsTotal: 8,
    preDrawRounds: 2,
    pairingMode: 'balanced',
    points: { win: 3, draw: 1, loss: 0 },
    ranking: { primary: 'points_per_played_match', tieBreakers: ['head_to_head', 'goal_diff', 'goals_for'] },
    schedule: {
      tournamentStartISO: now,
      matchMinutes: 12,
      turnoverMinutes: 3,
      roundBreakMinutes: 5,
      allocation: 'max_capacity',
    },
    fieldIds: [],
    currentRound: 0,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function makeTeams(tid: string, names: string[]): Team[] {
  const now = iso(new Date());
  return names.map((name, i) => ({ id: `${tid}-t${i + 1}`, tournamentId: tid, name, status: 'active', joinedAt: now, seed: i + 1 }));
}

function makeFields(tid: string, names: string[]): Field[] {
  return names.map((name, i) => ({ id: `${tid}-f${i + 1}`, tournamentId: tid, name, order: i, active: true }));
}

function buildRound(
  tid: string,
  number: number,
  teams: Team[],
  fields: Field[],
  startISO: string,
  t: Tournament,
  rand: () => number,
): { round: Round; matches: Match[]; byes: Bye[] } {
  const ids = teams.map((tm) => tm.id).sort(() => rand() - 0.5);
  const byes: Bye[] = [];
  const roundId = `${tid}-r${number}`;
  if (ids.length % 2 === 1) {
    const bye = ids.pop()!;
    byes.push({ id: `${roundId}-bye`, roundId, teamId: bye, reason: 'odd_team_count' });
  }
  const pairCount = ids.length / 2;
  const slots = planWaves(
    pairCount,
    fields.map((f) => f.id),
    startISO,
    t.schedule.matchMinutes,
    t.schedule.turnoverMinutes,
    t.schedule.allocation,
  );
  const now = iso(new Date());
  const matches: Match[] = slots.map((s, i) => ({
    id: `${roundId}-m${i + 1}`,
    roundId,
    roundNumber: number,
    teamAId: ids[i * 2]!,
    teamBId: ids[i * 2 + 1]!,
    fieldId: s.fieldId,
    waveIndex: s.waveIndex,
    startISO: s.startISO,
    durationMinutes: t.schedule.matchMinutes,
    status: 'scheduled',
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }));
  return {
    round: {
      id: roundId,
      number,
      status: 'published',
      mode: number <= t.preDrawRounds ? 'draw' : 'swiss',
      plannedStartISO: startISO,
      generatedFromRevision: 1,
      publishedAt: now,
      frozenPairings: true,
    },
    matches,
    byes,
  };
}

function finish(m: Match, rand: () => number): void {
  m.status = 'completed';
  m.goalsA = Math.floor(rand() * 4);
  m.goalsB = Math.floor(rand() * 4);
  m.completedAt = m.startISO;
}

function herbstcup(): TournamentData {
  const tid = 'herbstcup';
  const rand = mulberry32(2026);
  // Startzeit so legen, dass Runde 2 gerade läuft.
  const start = new Date(Date.now() - 50 * 60000);
  start.setSeconds(0, 0);
  start.setMinutes(Math.floor(start.getMinutes() / 5) * 5);
  const fields = makeFields(tid, ['Platz A', 'Platz B', 'Platz C', 'Platz D']);
  const t = baseTournament(tid, {
    title: 'Herbstcup 2026',
    organizerName: 'SV Blau-Weiß Nord',
    venue: 'Sportpark am See',
    status: 'running',
    visibility: 'full',
    currentRound: 2,
    fieldIds: fields.map((f) => f.id),
    ranking: { primary: 'points_per_played_match', tieBreakers: ['head_to_head', 'goal_diff', 'goals_for', 'buchholz'] },
    schedule: {
      tournamentStartISO: iso(start),
      matchMinutes: 12,
      turnoverMinutes: 3,
      roundBreakMinutes: 5,
      allocation: 'max_capacity',
    },
    publishedAt: iso(start),
  });
  const teams = makeTeams(tid, TEAM_NAMES);
  const roundLen = 2 * 12 + 3 + 5;
  const r1 = buildRound(tid, 1, teams, fields, iso(start), t, rand);
  const r2 = buildRound(tid, 2, teams, fields, iso(new Date(start.getTime() + roundLen * 60000)), t, rand);
  r1.matches.forEach((m) => finish(m, rand));
  r1.round.status = 'closed';
  r1.round.closedAt = iso(new Date());
  r2.round.status = 'active';
  r2.matches.slice(0, 3).forEach((m) => finish(m, rand));
  const live = r2.matches[3]!;
  live.status = 'live';
  live.goalsA = 1;
  live.goalsB = 0;
  return {
    tournament: t,
    teams,
    fields,
    sponsors: [
      { id: `${tid}-s1`, name: 'Bäckerei Korn', url: 'https://example.org', order: 0 },
      { id: `${tid}-s2`, name: 'Autohaus Nord', order: 1 },
      { id: `${tid}-s3`, name: 'Stadtwerke', url: 'https://example.org', order: 2 },
    ],
    rounds: [r1.round, r2.round],
    matches: [...r1.matches, ...r2.matches],
    byes: [...r1.byes, ...r2.byes],
    assets: {},
  };
}

function minicup(): TournamentData {
  const tid = 'minicup';
  const rand = mulberry32(7);
  const date = new Date(Date.now() + 4 * 86400000);
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  date.setHours(10, 0, 0, 0);
  const fields = makeFields(tid, ['Kleinfeld 1', 'Kleinfeld 2', 'Kleinfeld 3']);
  const t = baseTournament(tid, {
    title: 'Mini-Cup F-Jugend',
    organizerName: 'TSV Lindenhof',
    venue: 'Lindenhof-Arena',
    localDate,
    status: 'published',
    visibility: 'kids',
    roundsTotal: 5,
    preDrawRounds: 1,
    currentRound: 1,
    fieldIds: fields.map((f) => f.id),
    schedule: {
      tournamentStartISO: iso(date),
      matchMinutes: 10,
      turnoverMinutes: 5,
      roundBreakMinutes: 10,
      allocation: 'balanced_waves',
    },
  });
  const teams = makeTeams(tid, KIDS_NAMES);
  const r1 = buildRound(tid, 1, teams, fields, iso(date), t, rand);
  return { tournament: t, teams, fields, sponsors: [], rounds: [r1.round], matches: r1.matches, byes: r1.byes, assets: {} };
}

function wintercup(): TournamentData {
  const tid = 'wintercup';
  const fields = makeFields(tid, ['Halle 1', 'Halle 2']);
  const t = baseTournament(tid, {
    title: 'Wintercup Halle',
    organizerName: 'FC Hafenkante',
    venue: 'Dreifachhalle Süd',
    localDate: '2027-01-16',
    status: 'draft',
    roundsTotal: 6,
    preDrawRounds: 1,
    fieldIds: fields.map((f) => f.id),
  });
  return {
    tournament: t,
    teams: makeTeams(tid, TEAM_NAMES.slice(0, 10)),
    fields,
    sponsors: [],
    rounds: [],
    matches: [],
    byes: [],
    assets: {},
  };
}

/** Jeder gegen jeden für 4 Teams in 3 Spieltagen (Indizes in die Gruppe). */
const ROUND_ROBIN_4: Array<[number, number]> = [
  [0, 1],
  [2, 3],
  [0, 2],
  [1, 3],
  [0, 3],
  [1, 2],
];

/**
 * Baukasten-Beispiel (Vorlage 8 Teams): zwei Vierergruppen auf je einem festen Feld, danach Halbfinale,
 * Spiel um Platz 3, Finale und Platzierungsspiele. Gruppe A ist fertig, in Gruppe B läuft das letzte Spiel.
 * Die Endrunde steht noch als Platzhalter da. Von Hand gebaut, bis die Spielplan-Logik fertig ist.
 */
function sommercup(): TournamentData {
  const tid = 'sommercup';
  const rand = mulberry32(88);
  const format = FORMAT_TEMPLATES.find((x) => x.id === 't8')!.build();
  const matchMinutes = 10;
  const slotMinutes = matchMinutes + 2;
  const start = new Date(Date.now() - 5 * slotMinutes * 60000 - 4 * 60000);
  start.setSeconds(0, 0);
  const fields = makeFields(tid, ['Platz 1', 'Platz 2']);
  const t = baseTournament(tid, {
    title: 'Sommercup Gruppen',
    organizerName: 'VfL Eichenau',
    venue: 'Sportplatz Eichenau',
    status: 'running',
    visibility: 'full',
    roundsTotal: 0,
    preDrawRounds: 0,
    fieldIds: fields.map((f) => f.id),
    format,
    schedule: { tournamentStartISO: iso(start), matchMinutes, turnoverMinutes: 2, roundBreakMinutes: 0, allocation: 'max_capacity' },
    publishedAt: iso(start),
  });
  const teams = makeTeams(tid, TEAM_NAMES.slice(0, 8));
  const groups = [
    [0, 2, 4, 6].map((i) => teams[i]!.id),
    [1, 3, 5, 7].map((i) => teams[i]!.id),
  ];
  const now = iso(new Date());
  const at = (slot: number) => iso(new Date(start.getTime() + slot * slotMinutes * 60000));
  const base = (id: string, stageId: string, phase: number) => ({
    id,
    roundId: `${tid}-${stageId}`,
    roundNumber: phase + 1,
    durationMinutes: matchMinutes,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    stageId,
  });
  const matches: Match[] = [];
  groups.forEach((g, gi) => {
    ROUND_ROBIN_4.forEach(([a, b], i) => {
      matches.push({
        ...base(`${tid}-g${gi + 1}-${i + 1}`, 'vorrunde', 0),
        teamAId: g[a]!,
        teamBId: g[b]!,
        fieldId: fields[gi]!.id,
        waveIndex: i,
        startISO: at(i),
        status: 'scheduled',
        groupIndex: gi,
      });
    });
  });
  // Gruppe A ganz, Gruppe B bis auf das letzte Spiel; das läuft gerade.
  matches.slice(0, 11).forEach((m) => finish(m, rand));
  const live = matches[11]!;
  live.status = 'live';
  live.goalsA = 0;
  live.goalsB = 1;

  const ko = (key: string, slot: number, fi: number, slotA: SlotRef, slotB: SlotRef, stageId = 'endrunde', penaltyOnly = false): Match => ({
    ...base(`${tid}-${key.toLowerCase()}`, stageId, 1),
    teamAId: '',
    teamBId: '',
    fieldId: fields[fi]!.id,
    waveIndex: slot,
    startISO: iso(new Date(start.getTime() + (slot * slotMinutes + format.breakBeforeFinalsMinutes) * 60000)),
    status: 'scheduled',
    matchKey: key,
    slotA,
    slotB,
    ...(penaltyOnly ? { penaltyOnly } : {}),
  });
  const gp = (group: number, place: number): SlotRef => ({ kind: 'group_place', stageId: 'vorrunde', group, place });
  const res = (kind: 'winner' | 'loser', matchKey: string): SlotRef => ({ kind, stageId: 'endrunde', matchKey });
  const placement = format.stages.find((x): x is PlacementStage => x.kind === 'placement')!;
  matches.push(
    ko('SF1', 6, 0, gp(0, 1), gp(1, 2)),
    ko('SF2', 6, 1, gp(1, 1), gp(0, 2)),
    ...placement.matches.map((pm, i) => ko(pm.key, 7, i, pm.slotA, pm.slotB, placement.id)),
    ko('P3', 8, 0, res('loser', 'SF1'), res('loser', 'SF2'), 'endrunde', true),
    ko('F', 8, 1, res('winner', 'SF1'), res('winner', 'SF2')),
  );
  return {
    tournament: t,
    teams,
    fields,
    sponsors: [{ id: `${tid}-s1`, name: 'Getränke Weber', order: 0 }],
    rounds: [],
    matches,
    byes: [],
    assets: {},
    groupDraws: [{ stageId: 'vorrunde', groups, mode: 'random', seed: 88, updatedAt: iso(start) }],
    lots: [],
  };
}

export function createFixtures(): TournamentData[] {
  return [herbstcup(), minicup(), wintercup(), sommercup()];
}
