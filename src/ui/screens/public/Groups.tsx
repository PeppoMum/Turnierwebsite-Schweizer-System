// Zuschauerseite „Gruppen“ (Entwurf „Gruppen mit Mein Team“): am Computer alle Gruppen nebeneinander,
// am Handy Reiter A, B, C … mit den Spielen der gewählten Gruppe. Farbpunkte zeigen, wohin ein Platz führt.
import { useState } from 'react';
import type { GroupTableRow } from '../../../domain/format';
import type { PublicMatch } from '../../data/types';
import { formatSigned, formatTime } from '../../format';
import { href } from '../../router';
import { EmptyState, Notice } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { STAGE_COLORS, groupLetter, type GroupView, type PlaceMark, type StageTable } from './stageView';
import { Dot, FavPicker } from './parts';
import { durationOf, sidesOf, teamName, type Ctx } from './ctx';
import { useFavorite } from './favorite';

function markColor(marks: PlaceMark[] | undefined): string | undefined {
  const m = marks?.find((x) => !x.best) ?? marks?.[0];
  return m ? STAGE_COLORS[m.color] : undefined;
}

function Legend({ table, ctx }: { table: StageTable; ctx: Ctx }) {
  const next = ctx.model!.format.stages.filter((s) => s.entry?.fromStageId === table.stage.id);
  if (next.length === 0) return null;
  return (
    <div className="st-legend">
      {next.map((s) => (
        <span key={s.id}>
          <Dot color={STAGE_COLORS[s.color]} />
          {s.name}
        </span>
      ))}
      <span>
        <i className="st-dot st-dot-out" />
        Ausgeschieden
      </span>
    </div>
  );
}

function groupStatus(g: GroupView) {
  if (g.live)
    return (
      <span className="pill g">
        <i className="live-dot" aria-hidden />
        Läuft
      </span>
    );
  if (g.complete) return <span className="pill">Beendet</span>;
  return <span className="pill">{g.started ? 'Pause' : 'Geplant'}</span>;
}

function groupFoot(ctx: Ctx, g: GroupView): string {
  const played = g.matches.filter((m) => m.status === 'completed' || m.status === 'not_played').length;
  if (g.complete) return `Alle ${g.matches.length} Spiele gespielt.`;
  const live = g.matches.find((m) => m.status === 'live');
  if (live) {
    const score = ctx.scores && live.goalsA !== undefined ? ` ${live.goalsA}:${live.goalsB}` : '';
    return `Läuft gerade: ${teamName(ctx, live.teamAId)} – ${teamName(ctx, live.teamBId)}${score}. Stand jetzt, noch nicht fest.`;
  }
  return played === 0 ? 'Noch kein Spiel gespielt.' : `${played} von ${g.matches.length} Spielen gespielt. Stand jetzt, noch nicht fest.`;
}

/** Gleiches Feld für alle Spiele der Gruppe? Dann steht es neben dem Namen. */
function groupField(ctx: Ctx, g: GroupView): string | undefined {
  const ids = new Set(g.matches.map((m) => m.fieldId));
  return ids.size === 1 ? ctx.field([...ids][0]) || undefined : undefined;
}

function GroupTable({ ctx, table, g, fav, full }: { ctx: Ctx; table: StageTable; g: GroupView; fav: string | null; full: boolean }) {
  const marks = ctx.model!.marks(table.stage.id);
  const row = (r: GroupTableRow) => {
    const color = markColor(marks.get(r.place));
    const diff = r.goalsFor - r.goalsAgainst;
    return (
      <tr key={r.teamId} className={r.teamId === fav ? 'mine' : undefined}>
        <td className="l st-pl">
          <span>
            {color ? <Dot color={color} /> : <i className="st-dot st-dot-out" />}
            {r.place}.
          </span>
        </td>
        <td className="l st-tname">{teamName(ctx, r.teamId)}</td>
        {full && (
          <>
            <td>{r.played}</td>
            <td className="st-wide">{r.won}</td>
            <td className="st-wide">{r.drawn}</td>
            <td className="st-wide">{r.lost}</td>
            <td className="st-wide">
              {r.goalsFor}:{r.goalsAgainst}
            </td>
            <td>{formatSigned(diff)}</td>
            <td className="st-pts">{r.points}</td>
          </>
        )}
      </tr>
    );
  };
  return (
    <table className="table st-gt">
      <thead>
        <tr>
          <th className="l">Pl.</th>
          <th className="l">Team</th>
          {full && (
            <>
              <th>
                <abbr title="Spiele">Sp</abbr>
              </th>
              <th className="st-wide">
                <abbr title="Siege">S</abbr>
              </th>
              <th className="st-wide">
                <abbr title="Unentschieden">U</abbr>
              </th>
              <th className="st-wide">
                <abbr title="Niederlagen">N</abbr>
              </th>
              <th className="st-wide">Tore</th>
              <th>Diff</th>
              <th>Pkt</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {(full ? g.rows : [...g.rows].sort((a, b) => teamName(ctx, a.teamId).localeCompare(teamName(ctx, b.teamId), 'de'))).map(row)}
        {g.unranked.map((id) => (
          <tr key={id} className="dim">
            <td className="l">–</td>
            <td className="l st-tname">{teamName(ctx, id)} (spielt nicht mehr mit)</td>
            {full && <td colSpan={7} />}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GroupGames({ ctx, matches, fav }: { ctx: Ctx; matches: PublicMatch[]; fav: string | null }) {
  const tz = ctx.view.tournament.timeZone;
  return (
    <div className="st-games">
      {[...matches]
        .sort((a, b) => (a.startISO ?? '').localeCompare(b.startISO ?? ''))
        .map((m) => {
          const score = ctx.scores && m.goalsA !== undefined ? `${m.goalsA}:${m.goalsB}` : m.status === 'live' ? 'läuft' : '–';
          const cls = (id: string) => (id === fav ? 'st-fav' : undefined);
          return (
            <div key={m.id} className={m.status === 'live' ? 'st-gm live' : 'st-gm'}>
              <span className="st-gm-time">
                {formatTime(m.startISO, tz)}
                {durationOf(ctx, m) && <small className="st-gm-dur">{m.durationMinutes} Min.</small>}
              </span>
              <span className={cls(m.teamAId)}>{teamName(ctx, m.teamAId)}</span>
              <span className="st-gm-score">{score}</span>
              <span className={['st-gm-b', cls(m.teamBId)].filter(Boolean).join(' ')}>{teamName(ctx, m.teamBId)}</span>
            </div>
          );
        })}
    </div>
  );
}

function BestOf({ ctx, table, place, fav }: { ctx: Ctx; table: StageTable; place: number; fav: string | null }) {
  const b = ctx.model!.bestOf(table.stage.id, place);
  if (!b || b.rows.length === 0) return null;
  const color = markColor(ctx.model!.marks(table.stage.id).get(place)?.filter((m) => m.best));
  return (
    <section className="card st-card">
      <div className="st-card-head">
        <h2 className="section-title">Beste {place}.</h2>
        {!b.complete && <span className="pill y">Stand jetzt, noch nicht fest</span>}
      </div>
      <p className="small-text">
        Die besten {b.count} Gruppen-{place}. kommen weiter. Verglichen wird nach Punkten pro Spiel, dann Tordifferenz pro Spiel, dann
        Toren pro Spiel.
      </p>
      <div className="st-tablewrap">
        <table className="table st-gt">
          <thead>
            <tr>
              <th className="l">Rang</th>
              <th className="l">Team</th>
              <th className="l">Gruppe</th>
              <th>Sp</th>
              <th>Diff</th>
              <th>Pkt</th>
              <th>Pkt/Sp</th>
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={r.teamId} className={r.teamId === fav ? 'mine' : undefined}>
                <td className="l st-pl">
                  <span>
                    {i < b.count && color ? <Dot color={color} /> : <i className="st-dot st-dot-out" />}
                    {i + 1}.
                  </span>
                </td>
                <td className="l st-tname">{teamName(ctx, r.teamId)}</td>
                <td className="l">{groupLetter(r.group)}</td>
                <td>{r.played}</td>
                <td>{formatSigned(r.goalsFor - r.goalsAgainst)}</td>
                <td className="st-pts">{r.points}</td>
                <td>{r.played ? (r.points / r.played).toFixed(2).replace('.', ',') : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Kasten „Mein Team“ oben: Gruppe, Platz, wohin es geht, eigene Spiele. */
function MyTeamBox({ ctx, table, fav }: { ctx: Ctx; table: StageTable; fav: string }) {
  const g = table.groups.find((x) => x.teamIds.includes(fav));
  if (!g) return null;
  const row = g.rows.find((r) => r.teamId === fav);
  const marks = ctx.model!.marks(table.stage.id);
  let where = '';
  if (row) {
    const ms = marks.get(row.place) ?? [];
    const fixed = ms.find((m) => !m.best);
    const best = ms.find((m) => m.best);
    const nextStages = ctx.model!.format.stages.some((s) => s.entry?.fromStageId === table.stage.id);
    if (fixed) where = g.complete ? `spielt in der ${fixed.name}` : `wäre Stand jetzt in der ${fixed.name}`;
    else if (best) {
      const b = ctx.model!.bestOf(table.stage.id, row.place);
      const inside = (b?.rows.findIndex((r) => r.teamId === fav) ?? 99) < (b?.count ?? 0);
      where = b?.complete ? (inside ? `spielt in der ${best.name}` : 'ist ausgeschieden') : `hofft als ${row.place}. auf die ${best.name}`;
    } else if (nextStages) where = g.complete ? 'ist ausgeschieden' : 'wäre Stand jetzt ausgeschieden';
  }
  const own = g.matches.filter((m) => m.teamAId === fav || m.teamBId === fav).sort((a, b) => (a.startISO ?? '').localeCompare(b.startISO ?? ''));
  // Nächstes Spiel auch aus der Endrunde, wenn das Team dort schon (oder Stand jetzt) steht.
  const next = ctx.view.matches
    .filter((m) => m.status === 'scheduled' || m.status === 'live')
    .filter((m) => sidesOf(ctx, m).some((s) => s.teamId === fav))
    .sort((a, b) => (a.startISO ?? '').localeCompare(b.startISO ?? ''))[0];
  const tz = ctx.view.tournament.timeZone;
  const badge = (m: PublicMatch) => {
    if (m.status !== 'completed' || m.goalsA === undefined || !ctx.scores) return null;
    const mineGoals = m.teamAId === fav ? m.goalsA : m.goalsB!;
    const other = m.teamAId === fav ? m.goalsB! : m.goalsA;
    const r = mineGoals > other ? ['S', 's', 'Sieg'] : mineGoals < other ? ['N', 'n', 'Niederlage'] : ['U', 'u', 'Unentschieden'];
    return (
      <abbr className={`st-res ${r[1]}`} title={r[2]}>
        {r[0]}
      </abbr>
    );
  };
  return (
    <section className="card st-card st-me">
      <div className="st-card-head">
        <div className="st-me-title">
          <h2 className="section-title">{teamName(ctx, fav)}</h2>
          <span className="muted">
            {[table.groups.length > 1 ? `Gruppe ${g.name}` : table.stage.name, row ? `Platz ${row.place}` : 'spielt nicht mehr mit', where]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <a className="st-link" href={href({ name: 'public', id: ctx.view.tournament.id, tab: 'team' })}>
          Alle Spiele von {teamName(ctx, fav)} ›
        </a>
      </div>
      <div className="st-mini-grid">
        {own
          .filter((m) => m.status !== 'scheduled' && m.status !== 'live')
          .map((m) => (
            <div key={m.id} className="st-mini dk-only">
              <div className="st-mini-t">
                <span>
                  {formatTime(m.startISO, tz)} · {ctx.field(m.fieldId)}
                  {durationOf(ctx, m) ? ` · ${durationOf(ctx, m)}` : ''}
                </span>
                {badge(m)}
              </div>
              {(['A', 'B'] as const).map((s) => {
                const id = s === 'A' ? m.teamAId : m.teamBId;
                return (
                  <div key={s} className={id === fav ? 'st-mini-r st-fav' : 'st-mini-r'}>
                    <span>{teamName(ctx, id)}</span>
                    <b>{ctx.scores ? (s === 'A' ? m.goalsA : m.goalsB) : ''}</b>
                  </div>
                );
              })}
            </div>
          ))}
        {next && <NextMini ctx={ctx} m={next} fav={fav} />}
      </div>
    </section>
  );
}

function NextMini({ ctx, m, fav }: { ctx: Ctx; m: PublicMatch; fav: string }) {
  const [a, b] = sidesOf(ctx, m);
  const stage = ctx.model!.stageOf(m.stageId);
  const provisional = a.provisional || b.provisional;
  return (
    <div className="st-mini st-mini-next">
      <div className="st-mini-t">
        <b className="st-accent">
          {m.status === 'live' ? 'Läuft gerade' : 'Als Nächstes'} · {formatTime(m.startISO, ctx.view.tournament.timeZone)} · {ctx.field(m.fieldId)}
          {durationOf(ctx, m) ? ` · ${durationOf(ctx, m)}` : ''}
        </b>
      </div>
      {[a, b].map((s, i) => (
        <div key={i} className={s.teamId === fav ? 'st-mini-r st-fav' : 'st-mini-r'}>
          <span className={s.teamId ? undefined : 'st-open'}>{s.teamId ? teamName(ctx, s.teamId) : (s.slotLabel ?? 'Noch offen')}</span>
        </div>
      ))}
      {stage && stage.phase > 0 && (
        <div className="small-text st-round">
          {stage.color !== 'neutral' && <Dot color={STAGE_COLORS[stage.color]} />}
          {stage.name}
          {provisional ? ', Stand jetzt' : ''}
        </div>
      )}
    </div>
  );
}

export function Groups({ ctx }: { ctx: Ctx }) {
  const model = ctx.model!;
  const tables = [...model.tables.values()];
  const [fav, setFav] = useFavorite(ctx.view.tournament.id);
  // Zwischenrunde zeigen, sobald sie läuft; sonst die Vorrunde.
  const started = tables.filter((t) => t.groups.some((g) => g.started));
  const [stageId, setStageId] = useState<string>(() => (started[started.length - 1] ?? tables[0])?.stage.id ?? '');
  const table = tables.find((t) => t.stage.id === stageId) ?? tables[0];
  const favGroup = table?.groups.find((g) => fav && g.teamIds.includes(fav))?.index;
  const liveGroup = table?.groups.find((g) => g.live)?.index;
  const [picked, setPicked] = useState<number | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const full = ctx.view.tournament.visibility === 'full';

  if (!table) return <EmptyState text="Dieses Turnier hat keine Gruppen." />;
  const sel = picked ?? favGroup ?? liveGroup ?? 0;
  const selGroup = table.groups[sel];
  const anyLive = table.groups.some((g) => g.live);
  const title = table.groups.length > 1 ? 'Gruppen' : table.stage.name;
  const bestPlaces = [
    ...new Set(model.format.stages.flatMap((s) => (s.entry?.fromStageId === table.stage.id ? (s.entry?.best ?? []).map((b) => b.place) : []))),
  ];

  return (
    <>
      <div className="st-head">
        <div className="st-head-title">
          <h1 className="page-title">{title}</h1>
          {table.complete ? (
            <span className="pill">{table.stage.name} beendet</span>
          ) : anyLive || table.groups.some((g) => g.started) ? (
            <span className="pill g">
              <i className="live-dot" aria-hidden />
              {table.stage.name} läuft
            </span>
          ) : (
            <span className="pill">Noch nicht angepfiffen</span>
          )}
        </div>
        <FavPicker ctx={ctx} fav={fav} setFav={setFav} />
      </div>

      {tables.length > 1 && (
        <div className="seg" role="group" aria-label="Abschnitt">
          {tables.map((t) => (
            <button key={t.stage.id} type="button" aria-pressed={t.stage.id === table.stage.id} onClick={() => setStageId(t.stage.id)}>
              {t.stage.name}
            </button>
          ))}
        </div>
      )}

      {table.groups.every((g) => g.teamIds.length === 0) && (
        <Notice tone="hint" title="Die Gruppen stehen noch nicht fest.">
          Sie erscheinen hier, sobald die Teams aus dem vorigen Abschnitt feststehen.
        </Notice>
      )}

      {fav && <MyTeamBox ctx={ctx} table={table} fav={fav} />}

      {table.groups.length > 1 && (
        <div className="seg full ph-only st-tabs" role="tablist" aria-label="Gruppe">
          {table.groups.map((g) => (
            <button key={g.index} type="button" role="tab" aria-selected={g.index === sel} onClick={() => setPicked(g.index)}>
              {g.name}
              {g.index === favGroup && (
                <span className="st-star" aria-label="Mein Team">
                  <Icon name="star" />
                </span>
              )}
              {g.live && <span className="st-livemark" aria-label="läuft" />}
            </button>
          ))}
        </div>
      )}

      <div className="st-groups">
        {table.groups.map((g) => {
          const fieldName = table.stage.kind === 'groups' && table.stage.fixedFields ? groupField(ctx, g) : undefined;
          return (
            <section key={g.index} className={g.index === sel ? 'card st-card st-group sel' : 'card st-card st-group'} aria-label={`Gruppe ${g.name}`}>
              <div className="st-card-head">
                <h2 className="section-title">
                  {table.groups.length > 1 ? `Gruppe ${g.name}` : table.stage.name}
                  {fieldName && <span className="muted st-sub"> · {fieldName}</span>}
                </h2>
                {groupStatus(g)}
              </div>
              <div className="st-tablewrap">
                <GroupTable ctx={ctx} table={table} g={g} fav={fav} full={full} />
              </div>
              <p className="small-text">{groupFoot(ctx, g)}</p>
              <details className="st-details dk-only">
                <summary>Spiele in Gruppe {g.name}</summary>
                <GroupGames ctx={ctx} matches={g.matches} fav={fav} />
              </details>
            </section>
          );
        })}
      </div>

      <div className="ph-only st-legend-row">
        <Legend table={table} ctx={ctx} />
      </div>
      <div className="dk-only">
        <Legend table={table} ctx={ctx} />
      </div>

      {selGroup && (
        <section className="section ph-only">
          <h2 className="section-title">Spiele in {table.groups.length > 1 ? `Gruppe ${selGroup.name}` : table.stage.name}</h2>
          <div className="card st-card">
            <GroupGames
              ctx={ctx}
              matches={onlyMine && fav ? selGroup.matches.filter((m) => m.teamAId === fav || m.teamBId === fav) : selGroup.matches}
              fav={fav}
            />
          </div>
          {fav && selGroup.teamIds.includes(fav) && (
            <label className="check">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
              Nur Spiele von {teamName(ctx, fav)} zeigen
            </label>
          )}
        </section>
      )}

      {full && bestPlaces.map((p) => <BestOf key={p} ctx={ctx} table={table} place={p} fav={fav} />)}
    </>
  );
}

