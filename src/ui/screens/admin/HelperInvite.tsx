// Helfer per Link einladen. Der Link enthält nur eine Einladung; wer ihn öffnet, meldet sich mit eigenem Konto an.
import { useState } from 'react';
import { useAuthService, useService } from '../../data/context';
import { helperUrl } from '../../router';
import { ROLE_LABEL, type CreateInvitationInput } from '../../data/auth';
import { CopyButton, Notice, Seg, ShareButton } from '../../components/ui';

const VALIDITY = [
  { hours: 24, label: '1 Tag' },
  { hours: 72, label: '3 Tage' },
  { hours: 168, label: '7 Tage' },
  { hours: 720, label: '30 Tage' },
];

export function HelperInvite({ tid, title }: { tid: string; title: string }) {
  const auth = useAuthService();
  const [role, setRole] = useState<CreateInvitationInput['role']>('results_helper');
  const [hours, setHours] = useState(72);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!auth?.createInvitation) return null;
  const create = auth.createInvitation.bind(auth);

  return (
    <section className="card stack">
      <h2 className="card-title">Helfer einladen</h2>
      <Seg<CreateInvitationInput['role']>
        label="Rolle"
        value={role}
        onChange={(r) => {
          setRole(r);
          setLink(null);
        }}
        options={[
          { value: 'results_helper', label: 'Ergebnisse eintragen' },
          { value: 'extended_helper', label: ROLE_LABEL.extended_helper },
        ]}
      />
      <div className="inline-field">
        <label className="label" htmlFor="invite-validity">
          Link gültig
        </label>
        <select id="invite-validity" className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {VALIDITY.map((v) => (
            <option key={v.hours} value={v.hours}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      {error && <Notice tone="warn" title={error} />}
      {link ? (
        <>
          <code className="small-text" style={{ overflowWrap: 'anywhere' }}>
            {link}
          </code>
          <div className="row">
            <CopyButton text={link} />
            <ShareButton url={link} title={`Einladung: ${title}`} fallback={false} />
          </div>
          <span className="small-text">Jeder Link funktioniert genau einmal. Für mehrere Helfer erstellst du mehrere Links.</span>
        </>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setLink(await create(tid, { role, validForHours: hours }));
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Der Link ließ sich nicht erstellen.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Einen Moment …' : 'Einladungslink erstellen'}
          </button>
        </div>
      )}
    </section>
  );
}

/** Optionaler Helferlink ohne Anmeldung: ein Link für alle Helfer, jederzeit abschaltbar. */
export function OpenHelperLink({ tid, title, linkId }: { tid: string; title: string; linkId?: string | null }) {
  const service = useService();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = linkId ? helperUrl(tid, linkId) : null;

  const run = async (mode: 'on' | 'off' | 'renew') => {
    setBusy(true);
    setError(null);
    try {
      await service.setOpenHelperLink(tid, mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack">
      <h2 className="card-title">Helfer ohne Anmeldung</h2>
      <Seg<'off' | 'on'>
        label="Helfer ohne Anmeldung"
        value={link ? 'on' : 'off'}
        onChange={(v) => void run(v)}
        options={[
          { value: 'off', label: 'Aus', disabled: busy },
          { value: 'on', label: 'An', disabled: busy },
        ]}
      />
      <span className="muted">
        Wer diesen Link hat, kann ohne Konto und ohne Passwort Spiele anpfeifen und Ergebnisse eintragen. Gib ihn nur deinen Helfern.
      </span>
      {error && <Notice tone="warn" title={error} />}
      {link && (
        <>
          <code className="small-text" style={{ overflowWrap: 'anywhere' }}>
            {link}
          </code>
          <div className="row">
            <CopyButton text={link} />
            <ShareButton url={link} title={`Helferlink: ${title}`} fallback={false} />
            <button type="button" className="btn" disabled={busy} onClick={() => void run('renew')}>
              Neuen Link erzeugen
            </button>
          </div>
          <span className="small-text">Ausschalten oder ein neuer Link sperrt den alten Link sofort, auch für alle, die ihn schon benutzt haben.</span>
        </>
      )}
    </section>
  );
}
