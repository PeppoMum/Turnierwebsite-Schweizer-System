// Schiris aus Sicht der Turnierleitung: Schiri-Link (Einstellungen), Reiter „Schiris“ mit Einteilung und
// Meldungen, und ein Hinweis im Live-Cockpit, wenn Schiris Ergebnisse gemeldet haben.
import { useState } from 'react';
import { useService } from '../../data/context';
import { openReports, reportText } from '../../data/referees';
import { formatTime } from '../../format';
import { href, refereeUrl } from '../../router';
import { CopyButton, Notice, QrCode, Seg, ShareButton } from '../../components/ui';
import type { AdminCtx } from './AdminTournament';
import { stageCardProps } from './stages/cardProps';
import { RefereeBoard } from '../referee/RefereeBoard';
import { RenameDialog } from '../referee/RefereeScreen';

export function OpenRefereeLink({ tid, title, linkId }: { tid: string; title: string; linkId?: string | null }) {
  const service = useService();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState(false);
  const link = linkId ? refereeUrl(tid, linkId) : null;

  const run = async (mode: 'on' | 'off' | 'renew') => {
    setBusy(true);
    setError(null);
    try {
      await service.setOpenRefereeLink(tid, mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack">
      <h2 className="card-title">Schiri-Link</h2>
      <Seg<'off' | 'on'>
        label="Schiri-Link"
        value={link ? 'on' : 'off'}
        onChange={(v) => void run(v)}
        options={[
          { value: 'off', label: 'Aus', disabled: busy },
          { value: 'on', label: 'An', disabled: busy },
        ]}
      />
      <span className="muted">
        Schiris tragen sich mit diesem Link selbst mit Namen ein, teilen die Spiele unter sich auf und melden Ergebnisse. Am Spielplan ändern sie
        nichts, und ein gemeldetes Ergebnis zählt erst, wenn du es übernimmst. Zuschauer sehen nicht, wer pfeift.
      </span>
      {error && <Notice tone="warn" title={error} />}
      {link && (
        <>
          <code className="small-text" style={{ overflowWrap: 'anywhere' }}>
            {link}
          </code>
          <div className="row">
            <CopyButton text={link} />
            <ShareButton url={link} title={`Schiri-Link: ${title}`} fallback={false} />
            <button type="button" className="btn" onClick={() => setQr((v) => !v)}>
              {qr ? 'QR-Code ausblenden' : 'QR-Code zeigen'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void run('renew')}>
              Neuen Link erzeugen
            </button>
          </div>
          {qr && <QrCode text={link} />}
          <span className="small-text">
            Ausschalten oder ein neuer Link sperrt den alten Link sofort. Einteilung und Meldungen bleiben erhalten.{' '}
            <a href={href({ name: 'admin', id: tid, tab: 'schiris' })}>Zu den Schiris</a>
          </span>
        </>
      )}
    </section>
  );
}

export function RefereeTab({ ctx }: { ctx: AdminCtx }) {
  const service = useService();
  const t = ctx.data.tournament;
  const refs = ctx.data.referees ?? [];
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (id: string) => {
    setError(null);
    try {
      await service.removeReferee(t.id, id);
      setRemoving(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    }
  };

  return (
    <div className="stack">
      {!t.openRefereeLinkId && (
        <Notice tone="hint" title="Der Schiri-Link ist aus.">
          Schalte ihn unter <a href={href({ name: 'admin', id: t.id, tab: 'einstellungen' })}>Einstellungen</a> ein und gib ihn deinen Schiris. Ohne Link
          kannst du hier trotzdem alles sehen.
        </Notice>
      )}
      <section className="card stack">
        <h2 className="card-title">{refs.length === 0 ? 'Noch keine Schiris' : `${refs.length} ${refs.length === 1 ? 'Schiri' : 'Schiris'} eingetragen`}</h2>
        {refs.length === 0 ? (
          <span className="muted">Schiris tragen sich selbst mit dem Schiri-Link ein. Dann siehst du hier, wer da ist.</span>
        ) : (
          <div className="ref-names">
            {refs.map((r) => (
              <div key={r.id} className="ref-name-row">
                <b>{r.name}</b>
                <span className="small-text">seit {formatTime(r.joinedAt, t.timeZone)} Uhr</span>
                <span className="spacer" />
                {removing === r.id ? (
                  <>
                    <span className="small-text">Die Spiele werden wieder frei.</span>
                    <button type="button" className="btn" onClick={() => void remove(r.id)}>
                      Ja, austragen
                    </button>
                    <button type="button" className="btn" onClick={() => setRemoving(null)}>
                      Nein
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn" onClick={() => setRenaming({ id: r.id, name: r.name })}>
                      Umbenennen
                    </button>
                    <button type="button" className="btn" onClick={() => setRemoving(r.id)}>
                      Austragen
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {error && <span className="field-error">{error}</span>}
      </section>
      <RefereeBoard ctx={ctx} mode={{ kind: 'admin' }} />
      {renaming && <RenameDialog tid={t.id} refereeId={renaming.id} current={renaming.name} onClose={() => setRenaming(null)} />}
    </div>
  );
}

/** Im Live-Cockpit: Ergebnisse, die Schiris gemeldet haben und die noch auf die Turnierleitung warten. */
export function RefereeReportsNotice({ ctx }: { ctx: AdminCtx }) {
  const service = useService();
  const d = ctx.data;
  const t = d.tournament;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reports = openReports(d);
  if (reports.length === 0 || t.status === 'finished' || t.status === 'archived') return null;
  const refName = (id: string) => d.referees?.find((r) => r.id === id)?.name ?? 'Schiri';

  const accept = async (matchId: string) => {
    setBusy(matchId);
    setError(null);
    try {
      await service.acceptRefereeReport(t.id, matchId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card stack" aria-label="Gemeldete Ergebnisse">
      <h2 className="card-title">
        {reports.length === 1 ? 'Ein Schiri hat ein Ergebnis gemeldet' : `Schiris haben ${reports.length} Ergebnisse gemeldet`}
      </h2>
      <div className="ref-names">
        {reports.map(({ match: m, entry }) => {
          const extra = stageCardProps(d, m, ctx.teamName);
          return (
            <div key={m.id} className="ref-name-row">
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <span className="small-text">
                  {formatTime(m.startISO, t.timeZone)} · {ctx.fieldName(m.fieldId)}
                </span>
                <br />
                {extra?.nameA ?? ctx.teamName(m.teamAId)} – {extra?.nameB ?? ctx.teamName(m.teamBId)}: <b>{reportText(entry.report)}</b>{' '}
                <span className="small-text">({refName(entry.report.refereeId)})</span>
              </span>
              <span className="spacer" />
              <button type="button" className="btn pri" disabled={busy !== null} onClick={() => void accept(m.id)}>
                {busy === m.id ? 'Übernimmt …' : 'Übernehmen'}
              </button>
            </div>
          );
        })}
      </div>
      {error && <span className="field-error">{error}</span>}
      <span className="small-text">
        Stimmt etwas nicht, trag das Ergebnis wie gewohnt selbst ein. <a href={href({ name: 'admin', id: t.id, tab: 'schiris' })}>Alle Schiri-Meldungen</a>
      </span>
    </section>
  );
}
