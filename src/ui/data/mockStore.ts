// Beispiel-Datenhaltung im Browser (localStorage), bis Firestore angebunden ist.
import type { Match, Round, Team } from '../../domain';
import { createFixtures } from './fixtures';
import { createWaveSchedule, zonedLocalToISO } from '../../domain/schedule';
import { previewNextRound, toPublicView } from './logic';
import type { TournamentService } from './service';
import type { PublicTournamentView, TournamentData, WizardDraft } from './types';

const STORAGE_KEY = 'turnier-demo-v1';

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

  constructor(initial?: TournamentData[], private persist = true) {
    this.data = initial ?? this.load() ?? createFixtures();
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
    const fields = draft.fields.map((f, i) => ({ id: `${tid}-f${i + 1}`, tournamentId: tid, name: f.name.trim(), order: i, active: true }));
    const teams: Team[] = draft.teams
      .filter((t) => t.name.trim())
      .map((t, i) => ({
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
    this.data = [data, ...this.data];
    if (publish) {
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
    this.data = [copy, ...this.data];
    this.emit();
    return tid;
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    this.mutate(id, (d) => {
      if (archived) d.tournament.status = 'archived';
      else d.tournament.status = d.tournament.finishedAt ? 'finished' : d.tournament.publishedAt ? 'published' : 'draft';
    });
  }

  async setVisibility(id: string, visibility: TournamentData['tournament']['visibility']): Promise<void> {
    this.mutate(id, (d) => {
      d.tournament.visibility = visibility;
    });
  }

  async recordScore(tid: string, matchId: string, goalsA: number, goalsB: number): Promise<void> {
    if (!Number.isInteger(goalsA) || !Number.isInteger(goalsB) || goalsA < 0 || goalsB < 0) {
      throw new Error('Tore müssen ganze Zahlen ab 0 sein.');
    }
    this.mutateMatch(tid, matchId, (m) => {
      m.goalsA = goalsA;
      m.goalsB = goalsB;
      if (m.status === 'scheduled') m.status = 'live';
    });
  }

  async setMatchStatus(tid: string, matchId: string, status: 'scheduled' | 'live' | 'completed'): Promise<void> {
    this.mutateMatch(tid, matchId, (m) => {
      if (status === 'completed') {
        m.goalsA ??= 0;
        m.goalsB ??= 0;
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
      m.status = status;
      m.notPlayedReason = undefined;
    });
  }

  async markNotPlayed(tid: string, matchId: string, reason: NonNullable<Match['notPlayedReason']>): Promise<void> {
    this.mutateMatch(tid, matchId, (m) => {
      m.status = 'not_played';
      m.notPlayedReason = reason;
      m.goalsA = undefined;
      m.goalsB = undefined;
    });
  }

  async reopenMatch(tid: string, matchId: string): Promise<void> {
    this.mutateMatch(tid, matchId, (m) => {
      m.status = m.goalsA === undefined ? 'scheduled' : 'live';
      m.notPlayedReason = undefined;
      m.completedAt = undefined;
    });
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
  }

  async closeCurrentRound(tid: string): Promise<void> {
    this.mutate(tid, (d) => {
      const r = d.rounds.find((x) => x.number === d.tournament.currentRound);
      if (!r) return;
      r.status = 'closed';
      r.closedAt = nowISO();
    });
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
    return count;
  }

  async withdrawTeam(tid: string, teamId: string): Promise<void> {
    this.mutate(tid, (d) => {
      const t = d.teams.find((x) => x.id === teamId);
      if (!t) return;
      const started = d.matches.some((m) => (m.teamAId === teamId || m.teamBId === teamId) && m.status !== 'scheduled');
      t.status = started ? 'withdrawn' : 'no_show';
      t.withdrawnAt = nowISO();
      for (const m of d.matches) {
        if ((m.teamAId === teamId || m.teamBId === teamId) && m.status === 'scheduled') {
          m.status = 'not_played';
          m.notPlayedReason = started ? 'withdrawal' : 'no_show';
          m.revision += 1;
        }
      }
    });
  }

  async restoreTeam(tid: string, teamId: string): Promise<void> {
    this.mutate(tid, (d) => {
      const t = d.teams.find((x) => x.id === teamId);
      if (!t) return;
      t.status = 'active';
      t.withdrawnAt = undefined;
    });
  }

  async finishTournament(tid: string): Promise<void> {
    this.mutate(tid, (d) => {
      d.tournament.status = 'finished';
      d.tournament.finishedAt = nowISO();
      for (const r of d.rounds) if (r.status !== 'closed') r.status = 'closed';
    });
  }

  /** Nur für die Demo: Beispieldaten zurücksetzen. */
  reset(): void {
    this.data = createFixtures();
    this.emit();
  }
}

