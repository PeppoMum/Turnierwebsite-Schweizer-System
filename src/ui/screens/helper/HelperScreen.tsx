// Helferansicht über den Helferlink ohne Anmeldung: nur die laufende Runde mit Anpfiff und Ergebnissen.
import { useEffect, useState, type ReactNode } from 'react';
import { useAuthService, useLoading, useTournament } from '../../data/context';
import type { TournamentData } from '../../data/types';
import { formatDateShort } from '../../format';
import { EmptyState, Notice, Seg, TeamName, TournamentStatusPill } from '../../components/ui';
import { useAdminCtx } from '../admin/AdminTournament';
import { WaveBlock, groupByWave } from '../admin/LiveTab';

type JoinState = { state: 'joining' } | { state: 'ready' } | { state: 'error'; message: string };

export function HelperScreen({ tid, linkId }: { tid: string; linkId: string }) {
  const auth = useAuthService();
  const [join, setJoin] = useState<JoinState>(() => (auth?.joinWithHelperLink ? { state: 'joining' } : { state: 'ready' }));

  useEffect(() => {
    if (!auth?.joinWithHelperLink) return;
    let cancelled = false;
    auth
      .joinWithHelperLink(tid, linkId)
      .then(() => !cancelled && setJoin({ state: 'ready' }))
      .catch((e: unknown) => !cancelled && setJoin({ state: 'error', message: e instanceof Error ? e.message : 'Der Helferlink hat nicht geklappt.' }));
    return () => {
      cancelled = true;
    };
  }, [auth, tid, linkId]);

  if (join.state === 'joining') return <Page><span className="muted">Einen Moment …</span></Page>;
  if (join.state === 'error') {
    return (
      <Page>
        <h1 className="page-title">Helferlink</h1>
        <Notice tone="warn" title={join.message} />
      </Page>
    );
  }
  return <HelperData tid={tid} linkId={linkId} />;
}

function Page({ children }: { children: ReactNode }) {
  return <div className="page">{children}</div>;
}

function HelperData({ tid, linkId }: { tid: string; linkId: string }) {
  const data = useTournament(tid);
  const loading = useLoading(tid);
  if (!data) {
    if (loading) return <Page><span className="muted">Lädt …</span></Page>;
    return <Invalid />;
  }
  // Ohne Online-Speicher (Beispieldaten) prüft niemand sonst den Link.
  if (data.tournament.openHelperLinkId !== linkId) return <Invalid />;
  return <HelperLive data={data} />;
}

function Invalid() {
  return (
    <Page>
      <h1 className="page-title">Helferlink</h1>
      <Notice tone="warn" title="Dieser Helferlink gilt nicht mehr. Bitte frag die Turnierleitung nach dem aktuellen Link." />
    </Page>
  );
}

function HelperLive({ data }: { data: TournamentData }) {
  const ctx = useAdminCtx(data);
  const t = data.tournament;
  const [quick, setQuick] = useState(false);
  const round = data.rounds.find((r) => r.number === t.currentRound);
  const matches = data.matches.filter((m) => m.roundNumber === t.currentRound);
  const bye = round ? data.byes.find((b) => b.roundId === round.id) : undefined;
  const locked = t.status === 'finished' || t.status === 'archived';

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack tight" style={{ minWidth: 0 }}>
          <span className="small-text">
            {t.title} · {formatDateShort(t.localDate)}
          </span>
          <h1 className="page-title">{round ? `Runde ${round.number} von ${t.roundsTotal}` : 'Helfer'}</h1>
        </div>
        <TournamentStatusPill status={t.status} />
      </div>
      {!round ? (
        <EmptyState text="Noch keine Runde ausgelost. Sobald die Turnierleitung eine Runde veröffentlicht, erscheinen die Spiele hier." />
      ) : (
        <>
          <div className="row">
            <span className="small-text">Du hilfst ohne Anmeldung. Beendete Spiele korrigiert die Turnierleitung, sie lost auch die neuen Runden aus.</span>
            <span className="spacer" />
            <Seg
              label="Eingabe"
              value={quick ? 'quick' : 'normal'}
              onChange={(v) => setQuick(v === 'quick')}
              options={[
                { value: 'normal', label: 'Live' },
                { value: 'quick', label: 'Schnell' },
              ]}
            />
          </div>
          {groupByWave(matches).map((w) => (
            <WaveBlock key={w.wave} ctx={ctx} wave={w} quick={quick} locked={locked} canCorrect={false} />
          ))}
          {bye && (
            <div className="row">
              <span className="pill">Freilos</span>
              <TeamName name={ctx.teamName(bye.teamId)} logo={ctx.teamLogo(bye.teamId)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
