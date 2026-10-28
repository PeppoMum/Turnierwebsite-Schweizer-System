import type { Visibility } from '../../../domain';
import { useService } from '../../data/context';
import { formatDateShort, visibilityHelp, visibilityLabel } from '../../format';
import { publicUrl } from '../../router';
import { PAIRING_MODE_LABEL, TIE_BREAKER_LABEL } from '../../components/rules';
import { CopyButton, QrCode, Seg, ShareButton } from '../../components/ui';
import type { AdminCtx } from './AdminTournament';
import { HelperInvite, OpenHelperLink } from './HelperInvite';

export function SettingsTab({ ctx }: { ctx: AdminCtx }) {
  const service = useService();
  const t = ctx.data.tournament;
  const url = publicUrl(t.id);
  return (
    <div className="grid two">
      <section className="card stack">
        <h2 className="card-title">Was sehen Zuschauer?</h2>
        <Seg<Visibility>
          label="Sichtbarkeit"
          value={t.visibility}
          onChange={(v) => service.setVisibility(t.id, v)}
          options={(['full', 'no_standings', 'kids'] as const).map((v) => ({ value: v, label: visibilityLabel[v] }))}
        />
        <span className="muted">{visibilityHelp[t.visibility]}</span>
        <span className="small-text">Du siehst hier im Cockpit immer alles.</span>
      </section>

      <section className="card stack">
        <h2 className="card-title">Link und QR-Code</h2>
        {t.status === 'draft' ? (
          <span className="muted">Link und QR-Code gibt es, sobald die erste Runde veröffentlicht ist.</span>
        ) : (
          <>
            <QrCode text={url} />
            <code className="small-text" style={{ overflowWrap: 'anywhere' }}>
              {url}
            </code>
            <div className="row">
              <CopyButton text={url} />
              <ShareButton url={url} title={t.title} fallback={false} />
            </div>
          </>
        )}
      </section>

      <section className="card stack">
        <h2 className="card-title">Turnier</h2>
        <dl className="summary">
          <dt>Name</dt>
          <dd>{t.title}</dd>
          <dt>Veranstalter</dt>
          <dd>{t.organizerName}</dd>
          {t.venue && (
            <>
              <dt>Ort</dt>
              <dd>{t.venue}</dd>
            </>
          )}
          <dt>Datum</dt>
          <dd>{formatDateShort(t.localDate)}</dd>
          <dt>Felder</dt>
          <dd>{ctx.data.fields.map((f) => f.name).join(', ')}</dd>
          <dt>Spielzeit</dt>
          <dd>
            {t.schedule.matchMinutes} Min., Wechsel {t.schedule.turnoverMinutes} Min.
          </dd>
        </dl>
      </section>

      <section className="card stack">
        <h2 className="card-title">Wertung</h2>
        <dl className="summary">
          <dt>Runden</dt>
          <dd>
            {t.roundsTotal}, davon {t.preDrawRounds} ausgelost
          </dd>
          <dt>Gegnerwahl</dt>
          <dd>{PAIRING_MODE_LABEL[t.pairingMode]}</dd>
          <dt>Rangfolge</dt>
          <dd>Punkte pro Spiel, dann {t.ranking.tieBreakers.map((tb) => TIE_BREAKER_LABEL[tb]).join(', ')}</dd>
        </dl>
        <div className="row">
          <button type="button" className="btn" onClick={() => service.setArchived(t.id, t.status !== 'archived')}>
            {t.status === 'archived' ? 'Aus dem Archiv holen' : 'Archivieren'}
          </button>
        </div>
      </section>
      <OpenHelperLink tid={t.id} title={t.title} linkId={t.openHelperLinkId} />
      <HelperInvite tid={t.id} title={t.title} />
    </div>
  );
}
