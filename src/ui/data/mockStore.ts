// Beispiel-Datenhaltung im Browser (localStorage), bis Firestore angebunden ist.
import type { Match, Round, Team } from '../../domain';
import { createFixtures } from './fixtures';
import { createWaveSchedule, zonedLocalToISO } from '../../domain/schedule';
import { previewNextRound, toPublicView } from './logic';
import type { TournamentService } from './service';
import { assertDetails, checkedTeamName, detailsOf, movedStartISO, nextTeamId } from './details';
import { undoCheck } from './undo';
import {
  NOT_FOUND,
  applyGroupDraw,
  applyKnockoutResult,
  applyLayoutSnap,
  applyStagePlan,
  assertFormat,
  assertPlayable,
  checkFinishWithoutDecider,
  checkGroupDraw,
  checkKnockoutResult,
  fillSlotsIn,
  moveMatchIn,
  swapMatchesIn,
  swapSidesIn,
  withdrawQualifiedIn,
  type LayoutSnap,
} from './stages';
import type {
  GroupDraw,
  HistoryEntry,
  KnockoutResult,
  LotDecision,
  MatchMove,
  MatchSide,
  PlannedStageMatch,
  PublicTournamentView,
  SlotFill,
  TeamEdit,
  TournamentData,
  TournamentDetails,
  WithdrawalChoice,
  WizardDraft,
} from './types';

const STORAGE_KEY = 'turnier-demo-v1';
const HISTORY_KEY = 'turnier-demo-verlauf-v1';
const HISTORY_LIMIT = 300;

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Ortszeit des Turniers (z. B. 10:00 in Europe/Berlin) als Zeitpunkt, unabhängig von der Zeitzone des Geräts. */
export function localStartISO(localDate: string, time: string, timeZone: string): string {
  return zonedLocalToISO(localDate, time || '09:00', timeZone);
}

export class MockTournamentStore implements TournamentService {
  private data: TournamentData[];
  private listeners = new Set<() => void>();
  private publicCache = new Map<string, { src: TournamentData; view: PublicTournamentView }>();
  /** Änderungsverlauf je Turnier, neueste zuerst (Gegenstück zum Audit in Firestore). */
  private history: Record<string, HistoryEntry[]>;

  constructor(initial?: TournamentData[], private persist = true) {
    this.data = initial ?? this.load() ?? createFixtures();
    this.history = (initial ? null : this.loadHistoryStore()) ?? {};
  }

  private loadHistoryStore(): Record<string, HistoryEntry[]> | null {
    if (!this.persist) return null;
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? (JSON.parse(raw) as Record<string, HistoryEntry[]>) : null;
    } catch {
      return null;
    }
  }

  private log(tid: string, entry: Omit<HistoryEntry, 'id' | 'atISO' | 'actorUid'>): void {
    const list = this.history[tid] ?? [];
    this.history[tid] = [{ ...entry, id: uid('h'), atISO: nowISO(), actorUid: 'local' }, ...list].slice(0, HISTORY_LIMIT);
    this.persistHistory();
  }

  private persistHistory(): void {
    if (!this.persist) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
    } catch {
      // Verlauf ist nur eine Komfortfunktion der Demo.
    }
  }

  private logMatch(tid: string, matchId: string, action: string, fn: () => void): void {
    const snap = () => {
      const m = this.get(tid)?.matches.find((x) => x.id === matchId);
      return m
        ? {
            status: m.status,
            goalsA: m.goalsA ?? null,
            goalsB: m.goalsB ?? null,
            notPlayedReason: m.notPlayedReason ?? null,
            revision: m.revision,
            ...(m.stageId ? { decidedBy: m.decidedBy ?? null, penaltiesA: m.penaltiesA ?? null, penaltiesB: m.penaltiesB ?? null } : {}),
          }
        : null;
    };
    const before = snap();
    fn();
    this.log(tid, { action, targetType: 'match', targetId: matchId, before, after: snap() });
  }

  private load(): TournamentData[] | null {
    if (!this.persist) return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as TournamentData[]) : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    if (!this.persist) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Speicher voll oder gesperrt: Demo läuft trotzdem weiter.
    }
  }

  private emit(): void {
    this.save();
    this.listeners.forEach((l) => l());
  }

  private mutate(tid: string, fn: (d: TournamentData) => TournamentData | void): void {
    this.data = this.data.map((d) => {
      if (d.tournament.id !== tid) return d;
      const copy: TournamentData = structuredClone(d);
      const out = fn(copy) ?? copy;
      out.tournament.updatedAt = nowISO();
      out.tournament.revision += 1;
      return out;
    });
    this.emit();
  }

  private mutateMatch(tid: string, matchId: string, fn: (m: Match, d: TournamentData) => void): void {
    this.mutate(tid, (d) => {
      const m = d.matches.find((x) => x.id === matchId);
      if (!m) return;
      fn(m, d);
      m.revision += 1;
      m.updatedAt = nowISO();
      if (d.tournament.status === 'published' && (m.status === 'live' || m.status === 'completed')) {
        d.tournament.status = 'running';
      }
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getAll = (): TournamentData[] => this.data;

  get = (id: string): TournamentData | undefined => this.data.find((d) => d.tournament.id === id);

  getPublic = (id: string): PublicTournamentView | undefined => {
    const src = this.get(id);
    if (!src || src.tournament.status === 'draft') return undefined;
    const cached = this.publicCache.get(id);
    if (cached && cached.src === src) return cached.view;
    const view = toPublicView(src);
    this.publicCache.set(id, { src, view });
    return view;
  };

  async createTournament(draft: WizardDraft, publish: boolean): Promise<string> {
    const tid = draft.id && !this.get(draft.id) ? draft.id : uid('t');
    const now = nowISO();
    const assets: Record<string, string> = {};
    const asset = (url?: string) => {
      if (!url) return undefined;
      const id = uid('a');
      assets[id] = url;
      return id;
    };
    if (draft.format && draft.format.stages.length === 0) throw new Error('Das Turnier braucht mindestens einen Abschnitt.');
    const fields = draft.fields.map((f, i) => ({ id: `${tid}-f${i + 1}`, tournamentId: tid, name: f.name.trim(), order: i, active: true }));
    const teamIdMap = new Map<string, string>();
    const teams: Team[] = draft.teams
      .filter((t) => t.name.trim())
      .map((t, i) => (teamIdMap.set(t.id, `${tid}-t${i + 1}`), {
        id: `${tid}-t${i + 1}`,
        tournamentId: tid,
        name: t.name.trim(),
        status: t.active ? 'active' : 'inactive',
        joinedAt: now,
        seed: i + 1,
        logoAssetId: asset(t.logo),
      }));
    const startISO = localStartISO(draft.localDate, draft.startTime, draft.timeZone);
    const tieBreakers = draft.tieBreakers.filter((tb) => tb !== 'buchholz' || draft.buchholzEnabled);
    const data: TournamentData = {
      tournament: {
        id: tid,
        ownerUid: 'demo-admin',
        title: draft.title.trim(),
        organizerName: draft.organizerName.trim(),
        venue: draft.venue.trim() || undefined,
        localDate: draft.localDate,
        timeZone: draft.timeZone,
        organizerAssetId: asset(draft.organizerLogo),
        eventAssetId: asset(draft.eventLogo),
        status: publish ? 'published' : 'draft',
        visibility: draft.visibility,
        roundsTotal: draft.roundsTotal,
        preDrawRounds: draft.preDrawRounds,
        pairingMode: draft.pairingMode,
        points: { win: 3, draw: 1, loss: 0 },
        ranking: { primary: 'points_per_played_match', tieBreakers },
        schedule: {
          tournamentStartISO: startISO,
          matchMinutes: draft.matchMinutes,
          turnoverMinutes: draft.turnoverMinutes,
          roundBreakMinutes: draft.roundBreakMinutes,
          optionalHardRestMinutes: draft.hardRestMinutes ?? undefined,
          evenRest: draft.restOptimization,
          allocation: draft.allocation,
        },
        fieldIds: fields.map((f) => f.id),
        currentRound: 0,
        revision: 1,
        ...(draft.format ? { format: structuredClone(draft.format) } : {}),
        publishedAt: publish ? now : undefined,
        createdAt: now,
        updatedAt: now,
      },
      teams,
      fields,
      sponsors: draft.sponsors
        .filter((s) => s.name.trim())
        .map((s, i) => ({ id: `${tid}-s${i + 1}`, name: s.name.trim(), url: s.url.trim() || undefined, order: i, assetId: asset(s.logo) })),
      rounds: [],
      matches: [],
      byes: [],
      assets,
    };
    if (draft.format && draft.groupDraws) {
      const remapped = draft.groupDraws.map((g) => ({
        ...g,
        groups: g.groups.map((ids) => ids.map((id) => teamIdMap.get(id) ?? id)),
        ...(g.pots ? { pots: g.pots.map((ids) => ids.map((id) => teamIdMap.get(id) ?? id)) } : {}),
      }));
      data.groupDraws = remapped.map((g) => ({ ...checkGroupDraw(data, g), updatedAt: now }));
    }
    this.data = [data, ...this.data];
    this.log(tid, { action: 'tournament.create', targetType: 'tournament', targetId: tid, after: { title: data.tournament.title } });
    if (publish && !draft.format) {
      // Erste Runde direkt auslosen und veröffentlichen.
      const preview = previewNextRound(data);
      this.emit();
      await this.publishRound(tid, preview, startISO);
    } else {
      this.emit();
    }
    return tid;
  }

  async duplicateTournament(id: string): Promise<string> {
    const src = this.get(id);
    if (!src) throw new Error('Turnier nicht gefunden');
    const tid = uid('t');
    const copy: TournamentData = structuredClone(src);
    const now = nowISO();
    const remap = (old: string) => old.replace(src.tournament.id, tid);
    copy.tournament = {
      ...copy.tournament,
      id: tid,
      title: `${src.tournament.title} (Kopie)`,
      status: 'draft',
      currentRound: 0,
      revision: 1,
      publishedAt: undefined,
      finishedAt: undefined,
      openHelperLinkId: null,
      createdAt: now,
      updatedAt: now,
      fieldIds: copy.tournament.fieldIds.map(remap),
    };
    copy.teams = copy.teams.map((t) => ({ ...t, id: remap(t.id), tournamentId: tid, status: t.status === 'inactive' ? 'inactive' : 'active', withdrawnAt: undefined }));
    copy.fields = copy.fields.map((f) => ({ ...f, id: remap(f.id), tournamentId: tid }));
    copy.sponsors = copy.sponsors.map((s) => ({ ...s, id: remap(s.id) }));
    copy.rounds = [];
    copy.matches = [];
    copy.byes = [];
    copy.lots = undefined;
    copy.groupDraws = copy.groupDraws?.map((g) => ({
      ...g,
      groups: g.groups.map((ids) => ids.map(remap)),
      ...(g.pots ? { pots: g.pots.map((ids) => ids.map(remap)) } : {}),
    }));
    this.data = [copy, ...this.data];
    this.emit();
    return tid;
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    const before = this.get(id)?.tournament.status;
    this.mutate(id, (d) => {
      if (archived) d.tournament.status = 'archived';
      else d.tournament.status = d.tournament.finishedAt ? 'finished' : d.tournament.publishedAt ? 'published' : 'draft';
    });
    const status = this.get(id)?.tournament.status;
    this.log(id, { action: `tournament.status.${status}`, targetType: 'tournament', targetId: id, before: { status: before }, after: { status } });
  }

  async setVisibility(id: string, visibility: TournamentData['tournament']['visibility']): Promise<void> {
    const before = this.get(id)?.tournament.visibility;
    this.mutate(id, (d) => {
      d.tournament.visibility = visibility;
    });
    this.log(id, { action: 'tournament.visibility', targetType: 'visibility', targetId: id, before: { visibility: before }, after: { visibility } });
  }

  async setOpenHelperLink(id: string, mode: 'on' | 'off' | 'renew'): Promise<void> {
    this.mutate(id, (d) => {
      if (mode === 'on' && d.tournament.openHelperLinkId) return;
      d.tournament.openHelperLinkId = mode === 'off' ? null : uid('h') + uid('k');
    });
  }

  async recordScore(tid: string, matchId: string, goalsA: number, goalsB: number): Promise<void> {
    if (!Number.isInteger(goalsA) || !Number.isInteger(goalsB) || goalsA < 0 || goalsB < 0) {
      throw new Error('Tore müssen ganze Zahlen ab 0 sein.');
    }
    const src = this.get(tid);
    if (src) assertPlayable(src, matchId);
    const final = this.get(tid)?.matches.find((m) => m.id === matchId)?.status === 'completed';
    this.logMatch(tid, matchId, final ? 'match.result.final' : 'match.result.live', () =>
      this.mutateMatch(tid, matchId, (m) => {
        m.goalsA = goalsA;
        m.goalsB = goalsB;
        if (m.status === 'scheduled') m.status = 'live';
      }),
    );
  }

  async setMatchStatus(tid: string, matchId: string, status: 'scheduled' | 'live' | 'completed'): Promise<void> {
    const action = status === 'completed' ? 'match.result.final' : status === 'live' ? 'match.live' : 'match.reset';
    const src = this.get(tid);
    if (src && status !== 'scheduled') assertPlayable(src, matchId);
    this.logMatch(tid, matchId, action, () => this.mutateMatch(tid, matchId, (m, d) => {
      if (status === 'completed') {
        m.goalsA ??= 0;
        m.goalsB ??= 0;
        const decided = checkFinishWithoutDecider(d, m.id);
        if (decided) {
          m.decidedBy = decided;
          m.penaltiesA = undefined;
          m.penaltiesB = undefined;
        }
        m.completedAt = nowISO();
      }
      if (status === 'live') {
        m.goalsA ??= 0;
        m.goalsB ??= 0;
      }
      if (status === 'scheduled') {
        m.goalsA = undefined;
        m.goalsB = undefined;
      }
      if (status !== 'completed' && m.decidedBy) {
        m.decidedBy = undefined;
        m.penaltiesA = undefined;
        m.penaltiesB = undefined;
      }
      m.status = status;
      m.notPlayedReason = undefined;
    }));
  }

  async markNotPlayed(tid: string, matchId: string, reason: NonNullable<Match['notPlayedReason']>): Promise<void> {
    this.logMatch(tid, matchId, 'match.not_played', () =>
      this.mutateMatch(tid, matchId, (m) => {
        m.status = 'not_played';
        m.notPlayedReason = reason;
        m.goalsA = undefined;
        m.goalsB = undefined;
        m.decidedBy = undefined;
        m.penaltiesA = undefined;
        m.penaltiesB = undefined;
      }),
    );
  }

  async reopenMatch(tid: string, matchId: string): Promise<void> {
    this.logMatch(tid, matchId, 'match.reopen', () =>
      this.mutateMatch(tid, matchId, (m) => {
        m.status = m.goalsA === undefined ? 'scheduled' : 'live';
        m.notPlayedReason = undefined;
        m.completedAt = undefined;
        if (m.decidedBy === 'walkover') {
          m.decidedBy = undefined;
          m.walkoverWinner = undefined;
        }
      }),
    );
  }

  previewNextRound = (tid: string, seed?: number) => {
    const d = this.get(tid);
    if (!d) throw new Error('Turnier nicht gefunden');
    return previewNextRound(d, seed);
  };

  async publishRound(tid: string, preview: ReturnType<MockTournamentStore['previewNextRound']>, startISO: string): Promise<void> {
    this.mutate(tid, (d) => {
      const roundId = `${tid}-r${preview.roundNumber}`;
      const now = nowISO();
      const s = d.tournament.schedule;
      // Letztes Spielende je Team, damit die Planung Pausen über die Rundengrenze hinweg berücksichtigt.
      const teamLastEndISO: Record<string, string> = {};
      for (const m of d.matches) {
        if (!m.startISO || m.status === 'not_played' || m.status === 'cancelled') continue;
        const end = new Date(new Date(m.startISO).getTime() + m.durationMinutes * 60000).toISOString();
        for (const id of [m.teamAId, m.teamBId]) if (!teamLastEndISO[id] || teamLastEndISO[id]! < end) teamLastEndISO[id] = end;
      }
      const plan = createWaveSchedule(
        [{ roundNumber: preview.roundNumber, startISO, matches: preview.pairs.map((p, i) => ({ id: `${roundId}-m${i + 1}`, teamAId: p.teamAId, teamBId: p.teamBId })) }],
        d.fields,
        {
          tournamentStartISO: s.tournamentStartISO,
          matchMinutes: s.matchMinutes,
          turnoverMinutes: s.turnoverMinutes,
          roundBreakMinutes: s.roundBreakMinutes,
          optionalHardRestMinutes: s.optionalHardRestMinutes,
          evenRest: s.evenRest,
          allocation: s.allocation,
        },
        { teamLastEndISO, teamNames: new Map(d.teams.map((t) => [t.id, t.name])) },
      );
      if (plan.problems.length > 0) throw new Error(plan.problems.join(' '));
      const slot = new Map(plan.matches.map((m) => [m.matchId, m]));
      const round: Round = {
        id: roundId,
        number: preview.roundNumber,
        status: 'published',
        mode: preview.mode,
        plannedStartISO: plan.rounds[0]?.startISO ?? startISO,
        generatedFromRevision: d.tournament.revision,
        publishedAt: now,
        frozenPairings: true,
        pairingDiagnostics: preview.diagnostics,
      };
      d.rounds.push(round);
      preview.pairs.forEach((p, i) => {
        const id = `${roundId}-m${i + 1}`;
        const sm = slot.get(id);
        d.matches.push({
          id,
          roundId,
          roundNumber: preview.roundNumber,
          teamAId: p.teamAId,
          teamBId: p.teamBId,
          fieldId: sm?.fieldId,
          waveIndex: sm?.waveIndex,
          startISO: sm?.startISO,
          durationMinutes: s.matchMinutes,
          status: 'scheduled',
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
      });
      if (preview.byeTeamId) d.byes.push({ id: `${roundId}-bye`, roundId, teamId: preview.byeTeamId, reason: 'odd_team_count' });
      d.tournament.currentRound = preview.roundNumber;
      if (d.tournament.status === 'draft') {
        d.tournament.status = 'published';
        d.tournament.publishedAt = now;
      }
    });
    this.log(tid, { action: 'round.publish', targetType: 'round', targetId: `${tid}-r${preview.roundNumber}`, after: { roundNumber: preview.roundNumber } });
  }

  async closeCurrentRound(tid: string): Promise<void> {
    this.mutate(tid, (d) => {
      const r = d.rounds.find((x) => x.number === d.tournament.currentRound);
      if (!r) return;
      r.status = 'closed';
      r.closedAt = nowISO();
    });
    const t = this.get(tid)?.tournament;
    if (t) this.log(tid, { action: 'round.close', targetType: 'round', targetId: `${tid}-r${t.currentRound}` });
  }

  async shiftFutureMatches(tid: string, deltaMinutes: number): Promise<number> {
    let count = 0;
    this.mutate(tid, (d) => {
      for (const m of d.matches) {
        if (m.status !== 'scheduled' || !m.startISO) continue;
        m.startISO = new Date(new Date(m.startISO).getTime() + deltaMinutes * 60000).toISOString();
        m.revision += 1;
        count++;
      }
      for (const r of d.rounds) {
        if (d.matches.some((m) => m.roundId === r.id && m.status !== 'scheduled')) continue;
        r.plannedStartISO = new Date(new Date(r.plannedStartISO).getTime() + deltaMinutes * 60000).toISOString();
      }
    });
    this.log(tid, { action: 'schedule.shift', targetType: 'tournament', targetId: tid, after: { deltaMinutes } });
    return count;
  }

  async withdrawTeam(tid: string, teamId: string): Promise<void> {
    const matchIds: string[] = [];
    this.mutate(tid, (d) => {
      const t = d.teams.find((x) => x.id === teamId);
      if (!t) return;
      const started = d.matches.some((m) => (m.teamAId === teamId || m.teamBId === teamId) && m.status !== 'scheduled');
      t.status = started ? 'withdrawn' : 'no_show';
      t.withdrawnAt = nowISO();
      for (const m of d.matches) {
        if ((m.teamAId === teamId || m.teamBId === teamId) && m.status === 'scheduled') {
          matchIds.push(m.id);
          m.status = 'not_played';
          m.notPlayedReason = started ? 'withdrawal' : 'no_show';
          m.revision += 1;
        }
      }
    });
    const status = this.get(tid)?.teams.find((t) => t.id === teamId)?.status;
    this.log(tid, { action: `team.${status}`, targetType: 'tournament', targetId: tid, after: { teamId, status, matchIds } });
  }

  async restoreTeam(tid: string, teamId: string): Promise<void> {
    this.mutate(tid, (d) => {
      const t = d.teams.find((x) => x.id === teamId);
      if (!t) return;
      t.status = 'active';
      t.withdrawnAt = undefined;
    });
    this.log(tid, { action: 'team.restore', targetType: 'tournament', targetId: tid, after: { teamId } });
  }

  async finishTournament(tid: string): Promise<void> {
    this.mutate(tid, (d) => {
      d.tournament.status = 'finished';
      d.tournament.finishedAt = nowISO();
      for (const r of d.rounds) if (r.status !== 'closed') r.status = 'closed';
    });
    this.log(tid, { action: 'tournament.status.finished', targetType: 'tournament', targetId: tid, after: { status: 'finished' } });
  }

  async updateDetails(tid: string, details: TournamentDetails): Promise<void> {
    const src = this.get(tid);
    if (!src) throw new Error('Turnier nicht gefunden');
    assertDetails(src, details);
    const before = { title: src.tournament.title, organizerName: src.tournament.organizerName, venue: src.tournament.venue ?? null, localDate: src.tournament.localDate };
    const after = { title: details.title.trim(), organizerName: details.organizerName.trim(), venue: details.venue.trim() || null, localDate: details.localDate };
    this.mutate(tid, (d) => {
      const keep = (assetId: string | undefined, next: string | undefined) => {
        if (!next) return undefined;
        if (assetId && d.assets[assetId] === next) return assetId;
        const id = uid('a');
        d.assets[id] = next;
        return id;
      };
      const t = d.tournament;
      const startISO = movedStartISO(d, details.localDate);
      t.title = after.title;
      t.organizerName = after.organizerName;
      t.venue = after.venue ?? undefined;
      t.localDate = details.localDate;
      if (startISO) t.schedule.tournamentStartISO = startISO;
      t.organizerAssetId = keep(t.organizerAssetId, details.organizerLogo);
      t.eventAssetId = keep(t.eventAssetId, details.eventLogo);
      const old = new Map(d.sponsors.map((s) => [s.id, s]));
      d.sponsors = details.sponsors.map((s, i) => ({
        id: old.has(s.id) ? s.id : uid(`${tid}-s`),
        name: s.name.trim(),
        url: s.url.trim() || undefined,
        order: i,
        assetId: keep(old.get(s.id)?.assetId, s.logo),
      }));
    });
    this.log(tid, { action: 'tournament.update', targetType: 'tournament', targetId: tid, before, after });
  }

  async saveTeam(tid: string, teamId: string | null, team: TeamEdit): Promise<void> {
    const src = this.get(tid);
    if (!src) throw new Error('Turnier nicht gefunden');
    const name = checkedTeamName(src, teamId, team);
    const id = teamId ?? nextTeamId(src);
    const beforeName = src.teams.find((t) => t.id === teamId)?.name;
    this.mutate(tid, (d) => {
      let logoAssetId: string | undefined;
      const existing = d.teams.find((t) => t.id === id);
      if (team.logo) {
        logoAssetId = existing?.logoAssetId && d.assets[existing.logoAssetId] === team.logo ? existing.logoAssetId : uid('a');
        d.assets[logoAssetId] = team.logo;
      }
      if (existing) {
        existing.name = name;
        existing.logoAssetId = logoAssetId;
      } else {
        d.teams.push({ id, tournamentId: tid, name, status: 'active', joinedAt: nowISO(), seed: d.teams.length + 1, logoAssetId });
      }
    });
    this.log(tid, {
      action: teamId ? 'team.update' : 'team.add',
      targetType: 'team',
      targetId: id,
      before: beforeName ? { name: beforeName } : null,
      after: { teamId: id, name },
    });
  }

  async loadHistory(tid: string): Promise<HistoryEntry[]> {
    return this.history[tid] ?? [];
  }

  async undoHistory(tid: string, entry: HistoryEntry): Promise<void> {
    const d = this.get(tid);
    if (!d) throw new Error('Turnier nicht gefunden');
    const check = undoCheck(entry, d);
    if (!check?.ok) throw new Error(check?.reason ?? 'Dieser Schritt lässt sich nicht rückgängig machen.');
    const plan = check.plan;
    switch (plan.kind) {
      case 'match': {
        const { target } = plan;
        this.logMatch(tid, plan.matchId, 'match.undo', () =>
          this.mutateMatch(tid, plan.matchId, (m) => {
            const goals = target.status === 'completed' || (target.status === 'live' && target.goalsA !== null);
            if (target.status === 'completed' && m.status !== 'completed') m.completedAt = nowISO();
            if (target.status !== 'completed') m.completedAt = undefined;
            m.status = target.status;
            m.goalsA = goals ? (target.goalsA ?? 0) : undefined;
            m.goalsB = goals ? (target.goalsB ?? 0) : undefined;
            m.notPlayedReason = target.status === 'not_played' ? (target.notPlayedReason ?? 'other') : undefined;
            if (target.decided !== undefined) {
              m.decidedBy = target.decided.decidedBy ?? undefined;
              m.penaltiesA = target.decided.penaltiesA ?? undefined;
              m.penaltiesB = target.decided.penaltiesB ?? undefined;
            }
          }),
        );
        break;
      }
      case 'team-restore': {
        await this.restoreTeam(tid, plan.teamId);
        const reopened: string[] = [];
        this.mutate(tid, (x) => {
          for (const m of x.matches) {
            if (!plan.reopenMatchIds.includes(m.id) || m.status !== 'not_played') continue;
            m.status = 'scheduled';
            m.notPlayedReason = undefined;
            m.revision += 1;
            reopened.push(m.id);
          }
        });
        const head = this.history[tid]?.[0];
        if (head && reopened.length > 0) head.after = { ...(head.after as object), matchIds: reopened };
        break;
      }
      case 'team-withdraw':
        await this.withdrawTeam(tid, plan.teamId);
        break;
      case 'team-rename': {
        const team = d.teams.find((t) => t.id === plan.teamId);
        await this.saveTeam(tid, plan.teamId, { name: plan.name, logo: team?.logoAssetId ? d.assets[team.logoAssetId] : undefined });
        break;
      }
      case 'details': {
        const now = detailsOf(d);
        await this.updateDetails(tid, {
          ...now,
          title: plan.patch.title ?? now.title,
          organizerName: plan.patch.organizerName ?? now.organizerName,
          venue: 'venue' in plan.patch ? (plan.patch.venue ?? '') : now.venue,
          localDate: plan.patch.localDate ?? now.localDate,
        });
        break;
      }
      case 'visibility':
        await this.setVisibility(tid, plan.visibility);
        break;
      case 'shift':
        await this.shiftFutureMatches(tid, plan.deltaMinutes);
        break;
      case 'round-reopen': {
        this.mutate(tid, (x) => {
          const r = x.rounds.find((y) => y.id === plan.roundId);
          if (!r) return;
          r.status = 'active';
          r.closedAt = undefined;
        });
        const n = this.get(tid)?.rounds.find((r) => r.id === plan.roundId)?.number;
        this.log(tid, { action: 'round.reopen', targetType: 'round', targetId: plan.roundId, after: { roundNumber: n } });
        break;
      }
      case 'layout': {
        this.mutate(tid, (x) => {
          for (const s of plan.target) {
            const m = x.matches.find((y) => y.id === s.id);
            if (!m) continue;
            applyLayoutSnap(m, s);
            if (plan.reopen && m.status === 'not_played' && m.decidedBy === 'walkover') {
              m.status = 'scheduled';
              m.notPlayedReason = undefined;
              m.decidedBy = undefined;
              m.walkoverWinner = undefined;
            }
            m.revision += 1;
          }
        });
        this.logLayout(tid, 'matches.undo', plan.current, plan.target);
        break;
      }
      case 'group-draw': {
        await this.saveGroupDraw(tid, plan.draw);
        break;
      }
      case 'tournament-reopen': {
        this.mutate(tid, (x) => {
          x.tournament.status = 'running';
          x.tournament.finishedAt = undefined;
        });
        this.log(tid, { action: 'tournament.status.running', targetType: 'tournament', targetId: tid, before: { status: 'finished' }, after: { status: 'running' } });
        break;
      }
    }
    // Den neuen Eintrag mit dem zurückgenommenen verknüpfen (wie undoOf in Firestore).
    const head = this.history[tid]?.[0];
    if (head) head.after = { ...(head.after as object), undoOf: entry.id };
    this.persistHistory();
  }

  // ---- Turnier-Baukasten ----

  private formatData(tid: string): TournamentData {
    const d = this.get(tid);
    if (!d) throw new Error(NOT_FOUND);
    assertFormat(d);
    return d;
  }

  /** Wie in Firestore: Änderungen an mehreren Spielen hängen am Turnier, die Spiele stehen in `matches`. */
  private logLayout(tid: string, action: string, before: LayoutSnap[], after: LayoutSnap[], extra?: object): void {
    this.log(tid, { action, targetType: 'tournament', targetId: tid, before: { matches: before }, after: { matches: after, ...extra } });
  }

  /** Änderung an Ort, Zeit oder Gegnern: auf einer Kopie prüfen und anwenden, dann übernehmen. */
  private changeLayout(
    tid: string,
    action: string,
    fn: (d: TournamentData) => { before: LayoutSnap[]; after: LayoutSnap[]; matchIds?: string[] },
    extra?: object,
  ): void {
    this.formatData(tid);
    let res: ReturnType<typeof fn> | undefined;
    this.mutate(tid, (d) => {
      res = fn(d);
      const now = nowISO();
      for (const s of res.after) {
        const m = d.matches.find((x) => x.id === s.id);
        if (!m) continue;
        m.revision += 1;
        m.updatedAt = now;
      }
    });
    if (res) this.logLayout(tid, action, res.before, res.after, extra);
  }

  async saveGroupDraw(tid: string, draw: Omit<GroupDraw, 'updatedAt'>): Promise<void> {
    const src = this.formatData(tid);
    const clean = checkGroupDraw(src, draw);
    let before: GroupDraw | null = null;
    this.mutate(tid, (d) => {
      before = applyGroupDraw(d, clean, nowISO());
    });
    const b = before as GroupDraw | null;
    this.log(tid, {
      action: 'groups.draw',
      targetType: 'stage',
      targetId: clean.stageId,
      before: b ? { groups: b.groups, mode: b.mode, ...(b.pots ? { pots: b.pots } : {}) } : null,
      after: { groups: clean.groups, mode: clean.mode },
    });
  }

  async saveStagePlan(tid: string, matches: PlannedStageMatch[]): Promise<string[]> {
    this.formatData(tid);
    let ids: string[] = [];
    this.mutate(tid, (d) => {
      ids = applyStagePlan(d, matches, () => uid(`${tid}-m`), nowISO());
    });
    this.log(tid, { action: 'schedule.save', targetType: 'tournament', targetId: tid, after: { matchCount: ids.length } });
    return ids;
  }

  async finishKnockoutMatch(tid: string, matchId: string, result: KnockoutResult): Promise<void> {
    checkKnockoutResult(this.formatData(tid), matchId, result);
    this.logMatch(tid, matchId, 'match.result.final', () => this.mutateMatch(tid, matchId, (m) => applyKnockoutResult(m, result, nowISO())));
  }

  async swapMatches(tid: string, matchIdA: string, matchIdB: string): Promise<void> {
    this.changeLayout(tid, 'match.swap', (d) => swapMatchesIn(d, matchIdA, matchIdB));
  }

  async swapTeams(tid: string, a: MatchSide, b: MatchSide): Promise<void> {
    this.changeLayout(tid, 'match.swap_teams', (d) => swapSidesIn(d, a, b));
  }

  async moveMatch(tid: string, matchId: string, move: MatchMove): Promise<void> {
    this.changeLayout(tid, 'match.move', (d) => moveMatchIn(d, matchId, move));
  }

  async confirmSlotFills(tid: string, fills: SlotFill[]): Promise<void> {
    this.changeLayout(tid, 'finals.fill', (d) => fillSlotsIn(d, fills));
  }

  async saveLot(tid: string, lot: Omit<LotDecision, 'id' | 'atISO'>): Promise<void> {
    const src = this.formatData(tid);
    if (lot.order.length < 2) throw new Error('Ein Los braucht mindestens zwei Teams.');
    if (!src.tournament.format?.stages.some((s) => s.id === lot.stageId)) throw new Error('Unbekannter Abschnitt.');
    const key = (l: Omit<LotDecision, 'id' | 'atISO'>) => `${l.stageId}|${l.groupIndex ?? ''}|${l.place ?? ''}|${[...l.order].sort().join(',')}`;
    const saved: LotDecision = { ...lot, order: [...lot.order], id: uid('los'), atISO: nowISO() };
    this.mutate(tid, (d) => {
      d.lots = [...(d.lots ?? []).filter((l) => key(l) !== key(lot)), saved];
    });
    this.log(tid, { action: 'lot.draw', targetType: 'stage', targetId: lot.stageId, after: { order: saved.order, groupIndex: lot.groupIndex ?? null } });
  }

  async withdrawQualifiedTeam(tid: string, teamId: string, choice: WithdrawalChoice): Promise<void> {
    const src = this.formatData(tid);
    // Erst die Endrunden-Spiele umstellen, dann die übrigen offenen Spiele wie beim normalen Rückzug.
    this.changeLayout(tid, 'team.withdraw_qualified', (d) => withdrawQualifiedIn(d, teamId, choice), {
      teamId,
      choice: choice.kind,
      ...(choice.kind === 'replace' ? { byTeamId: choice.byTeamId } : {}),
    });
    if (src.teams.find((t) => t.id === teamId)?.status === 'active') await this.withdrawTeam(tid, teamId);
  }

  async publishTournament(tid: string): Promise<void> {
    const src = this.formatData(tid);
    if (src.tournament.status !== 'draft') return;
    this.mutate(tid, (d) => {
      d.tournament.status = 'published';
      d.tournament.publishedAt = nowISO();
    });
    this.log(tid, { action: 'tournament.publish', targetType: 'tournament', targetId: tid, after: { status: 'published' } });
  }

  /** Nur für die Demo: Beispieldaten zurücksetzen. */
  reset(): void {
    this.data = createFixtures();
    this.emit();
  }
}

