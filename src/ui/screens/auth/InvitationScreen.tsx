// Einladung als Helfer annehmen: anmelden, dann einmalig einlösen.
import { useEffect, useState } from 'react';
import { useAuthService, useAuthUser } from '../../data/context';
import { ROLE_LABEL, type InvitationInfo } from '../../data/auth';
import { navigate } from '../../router';
import { EmptyState, Notice } from '../../components/ui';
import { LoginForm } from './LoginForm';

export function InvitationScreen({ tid, inviteId }: { tid: string; inviteId: string }) {
  const auth = useAuthService();
  const user = useAuthUser();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    auth
      .getInvitation(tid, inviteId)
      .then((i) => !cancelled && setInfo(i))
      .catch((e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : 'Die Einladung ließ sich nicht laden.'));
    return () => {
      cancelled = true;
    };
  }, [auth, tid, inviteId]);

  if (!auth) {
    return (
      <div className="page">
        <h1 className="page-title">Einladung</h1>
        <EmptyState text="Einladungen funktionieren erst, wenn die App mit dem Online-Speicher verbunden ist." />
      </div>
    );
  }

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.redeemInvitation(tid, inviteId);
      navigate({ name: 'admin', id: tid, tab: 'live' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Einladung ließ sich nicht annehmen.');
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 520 }}>
      <h1 className="page-title">Einladung</h1>
      {loadError && <Notice tone="warn" title={loadError} />}
      {!info && !loadError && <span className="muted">Lädt …</span>}
      {info && (
        <div className="card stack">
          <h2 className="section-title">{info.tournamentTitle}</h2>
          <p>
            Du wirst als <b>{ROLE_LABEL[info.role]}</b> eingeladen.
            {info.role === 'results_helper' && ' Damit kannst du Ergebnisse eintragen.'}
            {info.role === 'extended_helper' && ' Damit kannst du Ergebnisse eintragen und beim Turnierablauf helfen.'}
          </p>
          {info.problem ? (
            <Notice tone="warn" title={info.problem} />
          ) : user === undefined ? (
            <span className="muted">Lädt …</span>
          ) : user === null ? (
            <LoginForm intro="Melde dich an oder leg ein Konto an. Danach kannst du die Einladung annehmen." />
          ) : (
            <>
              {user.email && <span className="small-text">Angemeldet als {user.email}</span>}
              {error && <Notice tone="warn" title={error} />}
              <div className="row">
                <button type="button" className="btn pri" disabled={busy} onClick={accept}>
                  {busy ? 'Einen Moment …' : 'Einladung annehmen'}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => auth.signOut()}>
                  Anderes Konto
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
