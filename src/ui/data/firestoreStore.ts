// Datenhaltung in Firestore hinter der Schnittstelle TournamentService (Gegenstück zu mockStore.ts).
// Lesen: onSnapshot-Abos füllen einen Zwischenspeicher, aus dem get/getAll/getPublic stabile
// Objekte liefern. Schreiben: über die Datenschicht in src/data (Transaktionen, Revision, Audit,
// öffentliche Projektion). Gäste lesen ausschließlich die öffentliche Projektion.
import type { Firestore } from 'firebase/firestore';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import type { Bye, Field, Match, Round, Sponsor, Team, TieBreaker } from '../../domain';
import { createWaveSchedule, zonedLocalToISO } from '../../domain/schedule';
import {
  DataError,
  closeRound,
  createTournament,
  markMatchNotPlayed,
  paths,
  publishRound as publishRoundData,
  recordResult,
  reopenMatchForCorrection,
  resetMatchToScheduled,
  restoreTeam as restoreTeamData,
  roundIdFor,
  saveAsset,
  saveRoundPreview,
  setMatchLive,
  setTournamentStatus,
  setVisibility as setVisibilityData,
  shiftFutureMatches as shiftFutureMatchesData,
  subscribeByes,
  subscribeFields,
  subscribeMatches,
  subscribeMyTournamentRefs,
  subscribePublicMatches,
  subscribePublicResults,
  subscribePublicRounds,
  subscribePublicStandings,
  subscribePublicTournament,
  subscribeQuery,
  subscribeRounds,
  subscribeSponsors,
  subscribeTeams,
  subscribeTournament,
  syncPublicTournament,
  toMatch,
  newOpenHelperLinkId,
  updateTournamentConfig,
  withdrawTeam as withdrawTeamData,
  type ActorSource,
  type AssetDoc,
  type AssetKind,
  type AssetMimeType,
  type MatchDoc,
  type MatchWriteOptions,
  type PreparedAsset,
  type PublicMatchDoc,
  type PublicResultDoc,
  type PublicRoundDoc,
  type PublicStandingsDoc,
  type PublicTournamentDoc,
  type Unsubscribe,
  type WithId,
} from '../../data';
import { iso } from '../../data/mappers';
import { computeStandings, previewNextRound } from './logic';
import type { TournamentService } from './service';
import type { PairingPreview, PublicTournamentView, TournamentData, WizardDraft } from './types';

type Loaded<T> = { value: T; loaded: boolean };
const empty = <T>(value: T): Loaded<T> => ({ value, loaded: false });

interface PrivateEntry {
  tournament: Loaded<(TournamentData['tournament'] & { resultsRevision: number }) | null>;
  teams: Loaded<Team[]>;
  fields: Loaded<Field[]>;
  sponsors: Loaded<Sponsor[]>;
  rounds: Loaded<Round[]>;
  matches: Loaded<Match[]>;
  byes: Loaded<Bye[]>;
  assets: Loaded<Record<string, string>>;
  unsubs: Unsubscribe[];
  snapshot?: TournamentData;
  dirty: boolean;
  /** Zeitpunkt eines Lesefehlers (z. B. Rolle noch nicht angelegt); danach neuer Versuch. */
  failedAt?: number;
}

const RETRY_MS = 3000;

interface PublicEntry {
  doc: Loaded<PublicTournamentDoc | null>;
  rounds: Loaded<WithId<PublicRoundDoc>[]>;
  matches: Loaded<WithId<PublicMatchDoc>[]>;
  results: Loaded<WithId<PublicResultDoc>[]>;
  standings: Loaded<PublicStandingsDoc | null>;
  assets: Loaded<Record<string, string>>;
  unsubs: Unsubscribe[];
  /** Abos, die vom Sichtbarkeitsmodus abhängen (Ergebnisse, Tabelle). */
  modeUnsubs: Unsubscribe[];
  mode?: PublicTournamentDoc['visibility'];
  view?: PublicTournamentView;
  dirty: boolean;
}

/** Ortszeit des Turniers als Zeitpunkt (wie im mockStore). */
function localStartISO(localDate: string, time: string, timeZone: string): string {
  return zonedLocalToISO(localDate, time || '09:00', timeZone);
}

/** Uhrzeit HH:MM eines Zeitpunkts in der Zeitzone des Turniers. */
function localTime(isoValue: string, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(isoValue),
  );
}

const DATA_URL_TYPE = /^data:(image\/(?:png|jpeg|webp));base64,/;

/** Data-URL aus der Bildauswahl in ein speicherbares Asset umwandeln. */
async function toPreparedAsset(dataUrl: string): Promise<PreparedAsset> {
  const match = DATA_URL_TYPE.exec(dataUrl);
  if (!match) {
    throw new DataError('invalid_input', 'Dieses Bildformat kann nicht gespeichert werden. Nimm bitte PNG, JPG oder WebP.');
  }
  let width = 256;
  let height = 256;
  try {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    // Ohne Bild-API (z. B. in Tests) gilt die Standardgröße der Bildauswahl.
  }
  return { dataUrl, mimeType: match[1] as AssetMimeType, width, height };
}

export class FirestoreTournamentStore implements TournamentService {
  private listeners = new Set<() => void>();
  private priv = new Map<string, PrivateEntry>();
  private pub = new Map<string, PublicEntry>();
  private refIds: string[] = [];
  private refsLoaded = false;
  private refsUnsub?: Unsubscribe;
  private all: TournamentData[] = [];
  private allDirty = true;
  private uid: string | null = null;

  constructor(
    private db: Firestore,
    private actors: ActorSource,
    private onError: (error: DataError) => void = (e) => console.error(e),
  ) {
    const initial = actors.current();
    this.uid = initial?.uid ?? null;
    // Anonyme Helfer (Helferlink ohne Anmeldung) haben keine Turnierliste.
    if (initial && !initial.anonymous) this.watchRefs();
    actors.onChange((actor) => {
      if ((actor?.uid ?? null) === this.uid) return;
      this.uid = actor?.uid ?? null;
      this.resetPrivate();
      if (actor && !actor.anonymous) this.watchRefs();
      this.emit();
    });
  }

  // ---------- Lesen ----------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getAll = (): TournamentData[] => {
    if (this.allDirty) {
      this.all = this.refIds
        .map((id) => this.snapshotOf(id))
        .filter((d): d is TournamentData => !!d)
        .sort((a, b) => b.tournament.createdAt.localeCompare(a.tournament.createdAt));
      this.allDirty = false;
    }
    return this.all;
  };

  get = (id: string): TournamentData | undefined => {
    if (!this.uid) return undefined;
    this.watchPrivate(id);
    return this.snapshotOf(id);
  };

  isLoading = (id?: string): boolean => {
    if (id === undefined) return !!this.uid && (!this.refsLoaded || this.refIds.some((r) => !this.isPrivateLoaded(r)));
    const p = this.priv.get(id);
    if (p) return !this.isPrivateLoaded(id);
    const q = this.pub.get(id);
    return q ? !this.isPublicLoaded(q) : true;
  };

  getPublic = (id: string): PublicTournamentView | undefined => {
    const entry = this.watchPublic(id);
    if (!this.isPublicLoaded(entry) || !entry.doc.value) return undefined;
    if (entry.dirty || !entry.view) {
      entry.view = this.buildPublicView(id, entry);
      entry.dirty = false;
    }
    return entry.view;
  };

  private emit(): void {
    this.allDirty = true;
    this.listeners.forEach((l) => l());
  }

  private reportError = (error: DataError) => this.onError(error);

  private watchRefs(): void {
    this.refsUnsub?.();
    this.refsLoaded = false;
    this.refsUnsub = subscribeMyTournamentRefs(
      this.db,
      this.uid!,
      (refs, meta) => {
        this.refIds = refs.map((r) => r.id);
        this.refsLoaded = true;
        // Eigene, noch nicht bestätigte Referenzen erst abonnieren, wenn der Server sie hat –
        // sonst lehnen die Regeln das Lesen ab, weil die Rolle dort noch fehlt.
        if (!meta.hasPendingWrites) for (const id of this.refIds) this.watchPrivate(id);
        this.emit();
      },
      this.reportError,
    );
  }

  private resetPrivate(): void {
    this.refsUnsub?.();
    this.refsUnsub = undefined;
    for (const e of this.priv.values()) e.unsubs.forEach((u) => u());
    this.priv.clear();
    this.refIds = [];
    this.refsLoaded = false;
  }

  private watchPrivate(tid: string): PrivateEntry {
    const existing = this.priv.get(tid);
    if (existing && !(existing.failedAt && Date.now() - existing.failedAt > RETRY_MS)) return existing;
    existing?.unsubs.forEach((u) => u());
    const entry: PrivateEntry = {
      tournament: empty(null),
      teams: empty([]),
      fields: empty([]),
      sponsors: empty([]),
      rounds: empty([]),
      matches: empty([]),
      byes: empty([]),
      assets: empty({}),
      unsubs: [],
      dirty: true,
    };
    this.priv.set(tid, entry);
    const set =
      <K extends 'tournament' | 'teams' | 'fields' | 'sponsors' | 'rounds' | 'matches' | 'byes' | 'assets'>(key: K) =>
      (value: PrivateEntry[K]['value']) => {
        entry[key] = { value, loaded: true } as PrivateEntry[K];
        entry.dirty = true;
        this.emit();
      };
    const fail = (err: DataError) => {
      if (!entry.failedAt) this.reportError(err);
      entry.failedAt = Date.now();
    };
    const db = this.db;
    entry.unsubs.push(
      subscribeTournament(db, tid, set('tournament'), fail),
      subscribeTeams(db, tid, (teams) => set('teams')(teams as Team[]), fail),
      subscribeFields(db, tid, (fields) => set('fields')(fields as Field[]), fail),
      subscribeSponsors(db, tid, (sponsors) => set('sponsors')(sponsors as Sponsor[]), fail),
      subscribeRounds(db, tid, (rounds) => set('rounds')(rounds), fail),
      subscribeMatches(db, tid, set('matches'), fail),
      subscribeByes(db, tid, (byes) => set('byes')(byes as Bye[]), fail),
      subscribeQuery(
        paths.assets(db, tid),
        (assets: WithId<AssetDoc>[]) => set('assets')(Object.fromEntries(assets.map((a) => [a.id, a.dataUrl]))),
        fail,
      ),
    );
    return entry;
  }

  private isPrivateLoaded(tid: string): boolean {
    const e = this.priv.get(tid);
    if (!e) return false;
    return [e.tournament, e.teams, e.fields, e.sponsors, e.rounds, e.matches, e.byes, e.assets].every((x) => x.loaded);
  }

  private snapshotOf(tid: string): TournamentData | undefined {
    const e = this.priv.get(tid);
    if (!e || !this.isPrivateLoaded(tid) || !e.tournament.value) return undefined;
    if (e.dirty || !e.snapshot) {
      const { resultsRevision: _r, ...tournament } = e.tournament.value;
      void _r;
      e.snapshot = {
        tournament,
        teams: e.teams.value,
        fields: e.fields.value,
        sponsors: e.sponsors.value,
        rounds: e.rounds.value,
        matches: e.matches.value,
        byes: e.byes.value,
        assets: e.assets.value,
      };
      e.dirty = false;
    }
    return e.snapshot;
  }

  private watchPublic(tid: string): PublicEntry {
    const existing = this.pub.get(tid);
    if (existing) return existing;
    const entry: PublicEntry = {
      doc: empty(null),
      rounds: empty([]),
      matches: empty([]),
      results: empty([]),
      standings: empty(null),
      assets: empty({}),
      unsubs: [],
      modeUnsubs: [],
      dirty: true,
    };
    this.pub.set(tid, entry);
    const update = () => {
      entry.dirty = true;
      this.emit();
    };
    const db = this.db;
    entry.unsubs.push(
      subscribePublicTournament(
        db,
        tid,
        (d) => {
          entry.doc = { value: d, loaded: true };
          this.applyPublicMode(tid, entry, d?.visibility);
          update();
        },
        (err) => {
          // Nicht (mehr) öffentlich: wie „nicht vorhanden“ behandeln.
          entry.doc = { value: null, loaded: true };
          if (err.code !== 'permission_denied') this.reportError(err);
          update();
        },
      ),
      subscribePublicRounds(db, tid, (r) => ((entry.rounds = { value: r, loaded: true }), update()), () => {
        entry.rounds = { value: [], loaded: true };
        update();
      }),
      subscribePublicMatches(db, tid, (m) => ((entry.matches = { value: m, loaded: true }), update()), () => {
        entry.matches = { value: [], loaded: true };
        update();
      }),
      subscribeQuery(
        paths.publicAssets(db, tid),
        (assets: WithId<AssetDoc>[]) => {
          entry.assets = { value: Object.fromEntries(assets.map((a) => [a.id, a.dataUrl])), loaded: true };
          update();
        },
        () => {
          entry.assets = { value: {}, loaded: true };
          update();
        },
      ),
    );
    return entry;
  }

  /** Ergebnis- und Tabellen-Abos nur, wenn der Modus sie erlaubt (sonst lehnen die Regeln ab). */
  private applyPublicMode(tid: string, entry: PublicEntry, mode: PublicEntry['mode']): void {
    if (mode === entry.mode) return;
    entry.mode = mode;
    entry.modeUnsubs.forEach((u) => u());
    entry.modeUnsubs = [];
    entry.results = { value: [], loaded: mode !== 'full' && mode !== 'no_standings' };
    entry.standings = { value: null, loaded: mode !== 'full' };
    const update = () => {
      entry.dirty = true;
      this.emit();
    };
    if (mode === 'full' || mode === 'no_standings') {
      entry.modeUnsubs.push(
        subscribePublicResults(this.db, tid, (r) => ((entry.results = { value: r, loaded: true }), update()), () => {
          entry.results = { value: [], loaded: true };
          update();
        }),
      );
    }
    if (mode === 'full') {
      entry.modeUnsubs.push(
        subscribePublicStandings(this.db, tid, (s) => ((entry.standings = { value: s, loaded: true }), update()), () => {
          entry.standings = { value: null, loaded: true };
          update();
        }),
      );
    }
  }

  private isPublicLoaded(e: PublicEntry): boolean {
    if (!e.doc.loaded) return false;
    if (!e.doc.value) return true;
    return [e.rounds, e.matches, e.results, e.standings, e.assets].every((x) => x.loaded);
  }

  private buildPublicView(tid: string, e: PublicEntry): PublicTournamentView {
    const d = e.doc.value!;
    const logo = (id: string | null) => (id ? e.assets.value[id] : undefined);
    const showScores = d.visibility !== 'kids';
    const results = new Map(e.results.value.map((r) => [r.matchId, r]));
    return {
      tournament: {
        id: tid,
        title: d.title,
        organizerName: d.organizerName,
        venue: d.venue ?? undefined,
        localDate: d.localDate,
        timeZone: d.timeZone,
        status: d.status,
        visibility: d.visibility,
        roundsTotal: d.roundsTotal,
        currentRound: d.currentRound,
      },
      organizerLogo: logo(d.organizerAssetId),
      eventLogo: logo(d.eventAssetId),
      teams: d.teams.map((t) => ({ id: t.id, name: t.name, status: t.status, logo: logo(t.logoAssetId) })),
      fields: d.fields.map((f) => ({ id: f.id, name: f.name, order: f.order })),
      sponsors: d.sponsors.map((s) => ({ id: s.id, name: s.name, url: s.url ?? undefined, logo: logo(s.assetId) })),
      rounds: e.rounds.value.map((r) => ({ number: r.number, plannedStartISO: r.plannedStartISO, status: r.status })),
      matches: e.matches.value.map((m) => {
        const r = showScores ? results.get(m.matchId) : undefined;
        const withScore = r && (m.status === 'completed' || m.status === 'live') && r.goalsA !== null && r.goalsB !== null;
        return {
          id: m.matchId,
          roundNumber: m.roundNumber,
          teamAId: m.teamAId,
          teamBId: m.teamBId,
          fieldId: m.fieldId ?? undefined,
          waveIndex: m.waveIndex ?? undefined,
          startISO: m.startISO ?? undefined,
          status: m.status,
          ...(withScore ? { goalsA: r.goalsA!, goalsB: r.goalsB! } : {}),
          ...(showScores && m.status === 'live' && !withScore ? { goalsA: 0, goalsB: 0 } : {}),
        };
      }),
      byes: e.rounds.value.flatMap((r) => (r.byeTeamIds ?? []).map((teamId) => ({ roundNumber: r.number, teamId }))),
      ...(d.visibility === 'full' && e.standings.value ? { standings: e.standings.value.rows } : {}),
      updatedAt: iso(d.updatedAt) ?? new Date().toISOString(),
    };
  }

  // ---------- Schreiben ----------

  private actor() {
    const actor = this.actors.current();
    if (!actor) {
      throw new DataError('permission_denied', 'Bitte melde dich an, um Änderungen zu speichern.');
    }
    return actor;
  }

  /** Geladene Daten oder eine verständliche Meldung, wenn sie (noch) fehlen. */
  private data(tid: string): TournamentData & { resultsRevision: number } {
    const d = this.get(tid);
    const t = this.priv.get(tid)?.tournament.value;
    if (!d || !t) {
      throw new DataError('not_found', 'Das Turnier ist noch nicht geladen. Bitte versuche es gleich noch einmal.');
    }
    return { ...d, resultsRevision: t.resultsRevision };
  }

  private match(tid: string, matchId: string): Match {
    const m = this.data(tid).matches.find((x) => x.id === matchId);
    if (!m) throw new DataError('not_found', 'Das Spiel wurde nicht gefunden.');
    return m;
  }

  /** Tabelle nach einer Spieländerung, für die öffentliche Projektion. */
  private standingsAfter(tid: string): MatchWriteOptions {
    return {
      standingsAfter: (updated: MatchDoc & { id: string }) => {
        const d = this.data(tid);
        const next = toMatch(updated.id, updated);
        const matches = d.matches.map((m) => (m.id === next.id ? next : m));
        return { rows: computeStandings({ ...d, matches }), throughRound: d.tournament.currentRound };
      },
    };
  }

  private standingsFor(d: TournamentData) {
    return { rows: computeStandings(d), throughRound: d.tournament.currentRound };
  }

  /** Nach dem ersten Anpfiff: Turnier läuft (nur der Owner darf das Turnier ändern). */
  private async markRunning(tid: string): Promise<void> {
    const t = this.priv.get(tid)?.tournament.value;
    if (!t || t.status !== 'published' || t.ownerUid !== this.uid) return;
    await setTournamentStatus(this.db, this.actor(), tid, t.revision, 'running').catch(() => undefined);
  }

  async createTournament(draft: WizardDraft, publish: boolean): Promise<string> {
    const actor = this.actor();
    const db = this.db;
    const requested = /^[A-Za-z0-9_-]{1,64}$/.test(draft.id) ? draft.id : undefined;
    const startISO = localStartISO(draft.localDate, draft.startTime, draft.timeZone);
    const tieBreakers: TieBreaker[] = draft.tieBreakers.filter((tb) => tb !== 'buchholz' || draft.buchholzEnabled);
    const tid = await createTournament(
      db,
      actor,
      {
        title: draft.title,
        organizerName: draft.organizerName.trim(),
        venue: draft.venue.trim() || undefined,
        localDate: draft.localDate,
        timeZone: draft.timeZone,
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
        fieldIds: [],
      },
      { tournamentId: requested },
    );

    const asset = async (dataUrl: string | undefined, kind: AssetKind) =>
      dataUrl ? saveAsset(db, tid, await toPreparedAsset(dataUrl), kind, { isPublic: true }) : undefined;
    const now = new Date().toISOString();
    const fields: Field[] = draft.fields.map((f, i) => ({
      id: `${tid}-f${i + 1}`,
      tournamentId: tid,
      name: f.name.trim(),
      order: i,
      active: true,
    }));
    const teams: Team[] = [];
    for (const [i, t] of draft.teams.filter((x) => x.name.trim()).entries()) {
      const logoAssetId = await asset(t.logo, 'team');
      teams.push({
        id: `${tid}-t${i + 1}`,
        tournamentId: tid,
        name: t.name.trim(),
        status: t.active ? 'active' : 'inactive',
        joinedAt: now,
        seed: i + 1,
        ...(logoAssetId ? { logoAssetId } : {}),
      });
    }
    const sponsors: Sponsor[] = [];
    for (const [i, s] of draft.sponsors.filter((x) => x.name.trim()).entries()) {
      const assetId = await asset(s.logo, 'sponsor');
      sponsors.push({
        id: `${tid}-s${i + 1}`,
        name: s.name.trim(),
        order: i,
        ...(s.url.trim() ? { url: s.url.trim() } : {}),
        ...(assetId ? { assetId } : {}),
      });
    }
    const organizerAssetId = await asset(draft.organizerLogo, 'organizer');
    const eventAssetId = await asset(draft.eventLogo, 'event');

    const batch = writeBatch(db);
    for (const { id, ...f } of fields) batch.set(doc(paths.fields(db, tid), id), f);
    for (const { id, ...t } of teams) batch.set(paths.team(db, tid, id), t);
    for (const { id, ...s } of sponsors) batch.set(doc(paths.sponsors(db, tid), id), s);
    await batch.commit();
    let revision = await updateTournamentConfig(db, actor, tid, 0, {
      fieldIds: fields.map((f) => f.id),
      ...(organizerAssetId ? { organizerAssetId } : {}),
      ...(eventAssetId ? { eventAssetId } : {}),
    });

    if (publish) {
      revision = await setTournamentStatus(db, actor, tid, revision, 'published');
      await syncPublicTournament(db, tid, { isPublic: true });
      const data: TournamentData = {
        tournament: {
          id: tid,
          ownerUid: actor.uid,
          title: draft.title.trim(),
          organizerName: draft.organizerName.trim(),
          localDate: draft.localDate,
          timeZone: draft.timeZone,
          status: 'published',
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
          revision,
          createdAt: now,
          updatedAt: now,
        },
        teams,
        fields,
        sponsors,
        rounds: [],
        matches: [],
        byes: [],
        assets: {},
      };
      await this.publishPreview(tid, { ...data, resultsRevision: 0 }, previewNextRound(data), startISO);
    } else {
      await syncPublicTournament(db, tid, { isPublic: false });
    }
    return tid;
  }

  async duplicateTournament(id: string): Promise<string> {
    const src = this.data(id);
    const t = src.tournament;
    const asset = (assetId?: string) => (assetId ? src.assets[assetId] : undefined);
    return this.createTournament(
      {
        id: '',
        title: `${t.title} (Kopie)`,
        organizerName: t.organizerName,
        venue: t.venue ?? '',
        localDate: t.localDate,
        timeZone: t.timeZone,
        organizerLogo: asset(t.organizerAssetId),
        eventLogo: asset(t.eventAssetId),
        sponsors: src.sponsors.map((s) => ({ id: s.id, name: s.name, url: s.url ?? '', logo: asset(s.assetId) })),
        teams: src.teams.map((tm) => ({
          id: tm.id,
          name: tm.name,
          active: tm.status !== 'inactive',
          logo: asset(tm.logoAssetId),
        })),
        roundsTotal: t.roundsTotal,
        preDrawRounds: t.preDrawRounds,
        pairingMode: t.pairingMode,
        tieBreakers: t.ranking.tieBreakers,
        buchholzEnabled: t.ranking.tieBreakers.includes('buchholz'),
        fields: src.fields.map((f) => ({ id: f.id, name: f.name })),
        startTime: localTime(t.schedule.tournamentStartISO, t.timeZone),
        matchMinutes: t.schedule.matchMinutes,
        turnoverMinutes: t.schedule.turnoverMinutes,
        roundBreakMinutes: t.schedule.roundBreakMinutes,
        restOptimization: t.schedule.evenRest !== false,
        hardRestMinutes: t.schedule.optionalHardRestMinutes ?? null,
        allocation: t.schedule.allocation,
        visibility: t.visibility,
      },
      false,
    );
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    const t = this.data(id).tournament;
    const status = archived ? 'archived' : t.finishedAt ? 'finished' : t.publishedAt ? 'published' : 'draft';
    await setTournamentStatus(this.db, this.actor(), id, t.revision, status);
  }

  async setVisibility(id: string, visibility: TournamentData['tournament']['visibility']): Promise<void> {
    const d = this.data(id);
    await setVisibilityData(this.db, this.actor(), id, d.tournament.revision, visibility, {
      standings: visibility === 'full' ? this.standingsFor(d) : undefined,
    });
  }

  async setOpenHelperLink(id: string, mode: 'on' | 'off' | 'renew'): Promise<void> {
    const d = this.data(id);
    if (mode === 'on' && d.tournament.openHelperLinkId) return;
    await updateTournamentConfig(this.db, this.actor(), id, d.tournament.revision, {
      openHelperLinkId: mode === 'off' ? null : newOpenHelperLinkId(),
    });
  }

  async recordScore(tid: string, matchId: string, goalsA: number, goalsB: number): Promise<void> {
    const m = this.match(tid, matchId);
    await recordResult(this.db, this.actor(), tid, matchId, goalsA, goalsB, m.revision, {
      ...this.standingsAfter(tid),
      finish: m.status === 'completed',
    });
    await this.markRunning(tid);
  }

  async setMatchStatus(tid: string, matchId: string, status: 'scheduled' | 'live' | 'completed'): Promise<void> {
    const m = this.match(tid, matchId);
    const actor = this.actor();
    const opts = this.standingsAfter(tid);
    if (status === 'scheduled') {
      if (m.status !== 'scheduled') await resetMatchToScheduled(this.db, actor, tid, matchId, m.revision, opts);
    } else if (status === 'live') {
      if (m.status === 'scheduled') await setMatchLive(this.db, actor, tid, matchId, m.revision, opts);
      else if (m.status === 'completed') await reopenMatchForCorrection(this.db, actor, tid, matchId, m.revision, opts);
      else if (m.status === 'not_played') {
        const reopened = await reopenMatchForCorrection(this.db, actor, tid, matchId, m.revision, opts);
        await setMatchLive(this.db, actor, tid, matchId, reopened.revision, opts);
      }
      await this.markRunning(tid);
    } else {
      await recordResult(this.db, actor, tid, matchId, m.goalsA ?? 0, m.goalsB ?? 0, m.revision, {
        ...opts,
        finish: true,
      });
      await this.markRunning(tid);
    }
  }

  async markNotPlayed(tid: string, matchId: string, reason: NonNullable<Match['notPlayedReason']>): Promise<void> {
    const m = this.match(tid, matchId);
    await markMatchNotPlayed(this.db, this.actor(), tid, matchId, reason, m.revision, this.standingsAfter(tid));
  }

  async reopenMatch(tid: string, matchId: string): Promise<void> {
    const m = this.match(tid, matchId);
    await reopenMatchForCorrection(this.db, this.actor(), tid, matchId, m.revision, this.standingsAfter(tid));
  }

  previewNextRound = (tid: string, seed?: number): PairingPreview => previewNextRound(this.data(tid), seed);

  async publishRound(tid: string, preview: PairingPreview, startISO: string): Promise<void> {
    await this.publishPreview(tid, this.data(tid), preview, startISO);
  }

  /** Felder/Wellen planen, Vorschau speichern und freigeben (wie mockStore.publishRound). */
  private async publishPreview(
    tid: string,
    d: TournamentData & { resultsRevision: number },
    preview: PairingPreview,
    startISO: string,
  ): Promise<void> {
    const actor = this.actor();
    const s = d.tournament.schedule;
    const teamLastEndISO: Record<string, string> = {};
    for (const m of d.matches) {
      if (!m.startISO || m.status === 'not_played' || m.status === 'cancelled') continue;
      const end = new Date(new Date(m.startISO).getTime() + m.durationMinutes * 60000).toISOString();
      for (const id of [m.teamAId, m.teamBId]) if (!teamLastEndISO[id] || teamLastEndISO[id]! < end) teamLastEndISO[id] = end;
    }
    const keys = preview.pairs.map((_, i) => `p${i + 1}`);
    const plan = createWaveSchedule(
      [
        {
          roundNumber: preview.roundNumber,
          startISO,
          matches: preview.pairs.map((p, i) => ({ id: keys[i]!, teamAId: p.teamAId, teamBId: p.teamBId })),
        },
      ],
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
    if (plan.problems.length > 0) throw new DataError('invalid_state', plan.problems.join(' '));
    const slot = new Map(plan.matches.map((m) => [m.matchId, m]));
    const { roundId } = await saveRoundPreview(this.db, actor, tid, {
      number: preview.roundNumber,
      mode: preview.mode,
      plannedStartISO: plan.rounds[0]?.startISO ?? startISO,
      generatedFromRevision: d.resultsRevision,
      frozenPairings: true,
      pairingDiagnostics: preview.diagnostics,
      matches: preview.pairs.map((p, i) => {
        const sm = slot.get(keys[i]!);
        return {
          teamAId: p.teamAId,
          teamBId: p.teamBId,
          fieldId: sm?.fieldId,
          waveIndex: sm?.waveIndex,
          startISO: sm?.startISO,
          durationMinutes: s.matchMinutes,
        };
      }),
      byeTeamIds: preview.byeTeamId ? [preview.byeTeamId] : [],
    });
    await publishRoundData(this.db, actor, tid, roundId);
    if (d.tournament.status === 'draft') {
      const fresh = await getDoc(paths.tournament(this.db, tid));
      await setTournamentStatus(this.db, actor, tid, fresh.data()?.revision ?? d.tournament.revision, 'published');
      await syncPublicTournament(this.db, tid, { isPublic: true });
    }
  }

  async closeCurrentRound(tid: string): Promise<void> {
    const d = this.data(tid);
    await closeRound(this.db, this.actor(), tid, roundIdFor(d.tournament.currentRound));
  }

  shiftFutureMatches(tid: string, deltaMinutes: number): Promise<number> {
    return shiftFutureMatchesData(this.db, this.actor(), tid, deltaMinutes);
  }

  async withdrawTeam(tid: string, teamId: string): Promise<void> {
    const d = this.data(tid);
    const teams = d.teams.map((t) => (t.id === teamId ? { ...t, status: 'withdrawn' as const } : t));
    await withdrawTeamData(this.db, this.actor(), tid, teamId, { standings: this.standingsFor({ ...d, teams }) });
  }

  async restoreTeam(tid: string, teamId: string): Promise<void> {
    const d = this.data(tid);
    const teams = d.teams.map((t) => (t.id === teamId ? { ...t, status: 'active' as const } : t));
    await restoreTeamData(this.db, this.actor(), tid, teamId, { standings: this.standingsFor({ ...d, teams }) });
  }

  async finishTournament(tid: string): Promise<void> {
    const t = this.data(tid).tournament;
    await setTournamentStatus(this.db, this.actor(), tid, t.revision, 'finished');
  }

  /** Alle Abos beenden (z. B. beim Abmelden oder in Tests). */
  dispose(): void {
    this.resetPrivate();
    for (const e of this.pub.values()) [...e.unsubs, ...e.modeUnsubs].forEach((u) => u());
    this.pub.clear();
  }
}

