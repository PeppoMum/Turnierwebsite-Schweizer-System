// Schiri-Ansicht über den Schiri-Link ohne Anmeldung: Namen eintragen, Spiele aufteilen, Ergebnisse melden.
import { useEffect, useState, type ReactNode } from 'react';
import { useAuthService, useLoading, useService, useTournament } from '../../data/context';
import type { TournamentData } from '../../data/types';
import { formatDateShort } from '../../format';
import { Dialog, Field, Notice, TournamentStatusPill } from '../../components/ui';
import { useAdminCtx } from '../admin/AdminTournament';
import { RefereeBoard } from './RefereeBoard';

type JoinState = { state: 'joining' } | { state: 'ready'; uid?: string } | { state: 'error'; message: string };

// Ohne Online-Speicher (Beispieldaten) merkt sich das Gerät, wer man ist.
const storeKey = (tid: string) => `turnier-schiri-${tid}`;
function storedId(tid: string): string | undefined {
  try {
    return localStorage.getItem(storeKey(tid)) ?? undefined;
  } catch {
    return undefined;
  }
}
function storeId(tid: string, id: string): void {
  try {
    localStorage.setItem(storeKey(tid), id);
  } catch {
    // Dann muss man den Namen beim nächsten Mal eben neu eintragen.
  }
}

export function RefereeScreen({ tid, linkId }: { tid: string; linkId: string }) {
  const auth = useAuthService();
  const [join, setJoin] = useState<JoinState>(() => (auth?.joinWithRefereeLink ? { state: 'joining' } : { state: 'ready' }));

  useEffect(() => {
    if (!auth?.joinWithRefereeLink) return;
    let cancelled = false;
    auth
      .joinWithRefereeLink(tid, linkId)
      .then((uid) => !cancelled && setJoin({ state: 'ready', uid }))
      .catch((e: unknown) => !cancelled && setJoin({ state: 'error', message: e instanceof Error ? e.message : 'Der Schiri-Link hat nicht geklappt.' }));
    return () => {
      cancelled = true;
    };
  }, [auth, tid, linkId]);

  if (join.state === 'joining') return <Page><span className="muted">Einen Moment …</span></Page>;
  if (join.state === 'error') {
    return (
      <Page>
        <h1 className="page-title">Schiri-Link</h1>
        <Notice tone="warn" title={join.message} />
      </Page>
    );
  }
  return <RefereeData tid={tid} linkId={linkId} uid={join.uid} />;
}

function Page({ children }: { children: ReactNode }) {
  return <div className="page">{children}</div>;
}

function RefereeData({ tid, linkId, uid }: { tid: string; linkId: string; uid?: string }) {
  const data = useTournament(tid);
  const loading = useLoading(tid);
  if (!data) {
    if (loading) return <Page><span className="muted">Lädt …</span></Page>;
    return <Invalid />;
  }
  // Ohne Online-Speicher prüft niemand sonst den Link.
  if (data.tournament.openRefereeLinkId !== linkId) return <Invalid />;
  return <RefereeHome data={data} uid={uid} />;
}

function Invalid() {
  return (
    <Page>
      <h1 className="page-title">Schiri-Link</h1>
      <Notice tone="warn" title="Dieser Schiri-Link gilt nicht mehr. Bitte frag die Turnierleitung nach dem aktuellen Link." />
    </Page>
  );
}

function RefereeHome({ data, uid }: { data: TournamentData; uid?: string }) {
  const ctx = useAdminCtx(data);
  const t = data.tournament;
  const [localId, setLocalId] = useState(() => storedId(t.id));
  const [renaming, setRenaming] = useState(false);
  const myId = uid ?? localId;
  const refs = data.referees ?? [];
  const me = myId ? refs.find((r) => r.id === myId) : undefined;

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack tight" style={{ minWidth: 0 }}>
          <span className="small-text">
            {t.title} · {formatDateShort(t.localDate)}
          </span>
          <h1 className="page-title">Schiedsrichter</h1>
        </div>
        <TournamentStatusPill status={t.status} />
      </div>
      {!me ? (
        <NameForm
          tid={t.id}
          myId={myId}
          others={refs.map((r) => r.name)}
          onSaved={(id) => {
            storeId(t.id, id);
            setLocalId(id);
          }}
        />
      ) : (
        <>
          <section className="card stack">
            <div className="row">
              <span>
                Du bist als <b>{me.name}</b> eingetragen.
              </span>
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setRenaming(true)}>
                Namen ändern
              </button>
            </div>
            <span className="small-text">
              {refs.length === 1 ? 'Bisher bist nur du da.' : `${refs.length} Schiris sind da: ${refs.map((r) => r.name).join(', ')}.`} Nimm dir Spiele mit „Pfeife ich“ oder
              lass dir eine Einteilung vorschlagen. Das ist nur ein Angebot und ändert nichts am Spielplan. Ergebnisse, die du meldest, übernimmt die
              Turnierleitung.
            </span>
          </section>
          <RefereeBoard ctx={ctx} mode={{ kind: 'referee', myId: me.id }} />
        </>
      )}
      {renaming && me && <RenameDialog tid={t.id} refereeId={me.id} current={me.name} onClose={() => setRenaming(false)} />}
    </div>
  );
}

function NameForm({ tid, myId, others, onSaved }: { tid: string; myId?: string; others: string[]; onSaved: (id: string) => void }) {
  const service = useService();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await service.saveReferee(tid, name, myId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card stack">
      <h2 className="card-title">Wie heißt du?</h2>
      <span className="muted">Trag deinen Namen ein, damit die anderen Schiris und die Turnierleitung sehen, wer welches Spiel pfeift. Zuschauer sehen ihn nicht.</span>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Dein Name" error={error ?? undefined}>
          {(id, describedBy) => (
            <input id={id} className="input" autoComplete="name" value={name} aria-describedby={describedBy} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <div className="row">
          <button type="submit" className="btn pri" disabled={busy || !name.trim()}>
            {busy ? 'Speichert …' : 'Los geht’s'}
          </button>
        </div>
      </form>
      {others.length > 0 && <span className="small-text">Schon da: {others.join(', ')}.</span>}
    </section>
  );
}

export function RenameDialog({ tid, refereeId, current, onClose }: { tid: string; refereeId: string; current: string; onClose: () => void }) {
  const service = useService();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await service.saveReferee(tid, name, refereeId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };
  return (
    <Dialog title="Namen ändern" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name" error={error ?? undefined}>
          {(id, describedBy) => <input id={id} className="input" value={name} aria-describedby={describedBy} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="row">
          <button type="submit" className="btn pri" disabled={busy || !name.trim()}>
            {busy ? 'Speichert …' : 'Speichern'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </form>
    </Dialog>
  );
}
