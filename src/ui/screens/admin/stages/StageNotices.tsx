// Hinweise an die Turnierleitung: Endrunde füllen (Vorschlag bestätigen), Korrekturen, die nicht mehr
// greifen, und Lose bei Gleichstand. Eingetragen wird nie von selbst (docs/turnier-baukasten.md).
import { useState } from 'react';
import { useService } from '../../../data/context';
import { href } from '../../../router';
import { Dialog, Notice } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import type { AdminCtx } from '../AdminTournament';
import { changeText, groupName, stageById, type OpenLot, type StageModel } from './model';
import './stages.css';

export function StageNotices({ ctx, model }: { ctx: AdminCtx; model: StageModel }) {
  const { changes, locked } = model.resolution;
  return (
    <>
      {model.openLots.map((lot) => (
        <LotNotice key={`${lot.stageId}|${lot.groupIndex ?? ''}|${lot.place ?? ''}|${lot.teamIds.join(',')}`} ctx={ctx} model={model} lot={lot} />
      ))}
      {changes.length > 0 && <FillNotice ctx={ctx} model={model} />}
      {locked.length > 0 && (
        <Notice tone="info" title="Gespielt ist gespielt">
          Nach einer Korrektur würden heute andere Teams in{' '}
          {locked.length === 1 ? 'einem Endrunden-Spiel' : `${locked.length} Endrunden-Spielen`} stehen. Diese Spiele laufen schon oder sind vorbei,
          deshalb bleiben sie, wie sie sind.
        </Notice>
      )}
    </>
  );
}

function FillNotice({ ctx, model }: { ctx: AdminCtx; model: StageModel }) {
  const service = useService();
  const { data } = ctx;
  const changes = model.resolution.changes;
  const corrections = changes.filter((c) => c.fromTeamId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await service.confirmSlotFills(
        data.tournament.id,
        changes.map((c) => ({ matchId: c.matchId, side: c.side, teamId: c.toTeamId })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    }
    setBusy(false);
  };
  return (
    <div className="notice hint no-close stage-fill" role="status">
      <b>{corrections.length > 0 ? 'Die Endrunde ändert sich durch eine Korrektur' : 'Endrunde füllen'}</b>
      <span>
        {corrections.length > 0
          ? 'Nach dem neuen Stand kommen andere Teams weiter. Bitte prüf die Änderung und bestätige sie.'
          : 'Diese Teams stehen jetzt fest. Mit „Eintragen“ sehen alle sie im Spielplan. Danach kannst du noch tauschen.'}
      </span>
      <ul className="stage-fill-list">
        {changes.map((c) => (
          <li key={`${c.matchId}${c.side}`}>{changeText(c, data, model.format, ctx.teamName)}</li>
        ))}
      </ul>
      {error && <span className="field-error">{error}</span>}
      <span className="row">
        <button type="button" className="btn pri" disabled={busy} onClick={confirm}>
          {busy ? 'Trägt ein …' : corrections.length > 0 ? 'Änderung bestätigen' : 'Eintragen'}
        </button>
        <a className="btn" href={href({ name: 'admin', id: data.tournament.id, tab: 'spielplan' })}>
          <Icon name="shuffle" />
          Im Spielplan tauschen
        </a>
      </span>
    </div>
  );
}

function lotTitle(lot: OpenLot, model: StageModel): string {
  const stage = stageById(model.format, lot.stageId);
  if (lot.groupIndex !== undefined) {
    const single = stage?.kind !== 'groups' || stage.groupCount === 1;
    return `Gleichstand in ${single ? (stage?.name ?? 'der Tabelle') : groupName(model.format, lot.stageId, lot.groupIndex)}`;
  }
  return `Gleichstand bei den besten ${lot.place}.`;
}

function LotNotice({ ctx, model, lot }: { ctx: AdminCtx; model: StageModel; lot: OpenLot }) {
  const [open, setOpen] = useState(false);
  const names = lot.teamIds.map(ctx.teamName);
  return (
    <div className="notice warn no-close" role="alert">
      <b>{lotTitle(lot, model)}: Los ziehen</b>
      <span>
        {names.join(', ')} sind in allem gleich. Jetzt entscheidet das Los. Bis du es ziehst, ist die Reihenfolge nur vorläufig und die
        Endrunde wartet.
      </span>
      <span>
        <button type="button" className="btn pri" onClick={() => setOpen(true)}>
          Los ziehen
        </button>
      </span>
      {open && <LotDialog ctx={ctx} model={model} lot={lot} onClose={() => setOpen(false)} />}
    </div>
  );
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Los am Gerät ziehen oder ein echtes Los (Münze, Zettel) übernehmen: Reihenfolge festlegen und speichern. */
function LotDialog({ ctx, model, lot, onClose }: { ctx: AdminCtx; model: StageModel; lot: OpenLot; onClose: () => void }) {
  const service = useService();
  const [order, setOrder] = useState(lot.teamIds);
  const [drawn, setDrawn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setOrder(next);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await service.saveLot(ctx.data.tournament.id, {
        stageId: lot.stageId,
        ...(lot.groupIndex !== undefined ? { groupIndex: lot.groupIndex } : {}),
        ...(lot.place !== undefined ? { place: lot.place } : {}),
        order,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das Los ließ sich nicht speichern.');
      setBusy(false);
    }
  };
  return (
    <Dialog title={`${lotTitle(lot, model)}: Los ziehen`} onClose={onClose}>
      <p style={{ margin: 0 }}>
        Lass das Gerät zufällig ziehen oder zieh selbst (Münze, Zettel) und stell die Reihenfolge mit den Pfeilen ein. Oben steht das Team, das
        vorne landet.
      </p>
      <div className="order-list">
        {order.map((id, i) => (
          <div key={id} className="order-item">
            <b style={{ width: 24 }}>{i + 1}.</b>
            <span className="grow">{ctx.teamName(id)}</span>
            <button type="button" className="btn compact sq" aria-label={`${ctx.teamName(id)} nach oben`} disabled={i === 0} onClick={() => move(i, -1)}>
              <Icon name="up" />
            </button>
            <button
              type="button"
              className="btn compact sq"
              aria-label={`${ctx.teamName(id)} nach unten`}
              disabled={i === order.length - 1}
              onClick={() => move(i, 1)}
            >
              <Icon name="down" />
            </button>
          </div>
        ))}
      </div>
      {drawn && <span className="small-text">Zufällig gezogen. Du kannst noch einmal ziehen, bis du speicherst.</span>}
      {error && <span className="field-error">{error}</span>}
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setOrder(shuffled(lot.teamIds));
            setDrawn(true);
          }}
        >
          <Icon name="shuffle" />
          Zufällig ziehen
        </button>
        <button type="button" className="btn pri" disabled={busy} onClick={save}>
          {busy ? 'Speichert …' : 'Los speichern'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}
