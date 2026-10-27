// Anmelden oder Konto anlegen für Turnierleitung und Helfer. Zuschauer brauchen kein Konto.
import { useState, type FormEvent } from 'react';
import { useAuthService } from '../../data/context';
import { Field, Notice, Seg } from '../../components/ui';

type Mode = 'login' | 'register';

export function LoginForm({ intro }: { intro?: string }) {
  const auth = useAuthService();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  if (!auth) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Anmeldung hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError('Bitte gib deine E-Mail-Adresse ein.');
    if (!password) return setError('Bitte gib dein Passwort ein.');
    void run(() => (mode === 'login' ? auth.signInWithEmail(email, password) : auth.registerWithEmail(email, password)));
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {intro && <p className="muted">{intro}</p>}
      <Seg<Mode>
        label="Anmelden oder registrieren"
        full
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError(null);
        }}
        options={[
          { value: 'login', label: 'Anmelden' },
          { value: 'register', label: 'Konto anlegen' },
        ]}
      />
      <Field label="E-Mail">
        {(id) => <input id={id} className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label="Passwort">
        {(id) => (
          <input
            id={id}
            className="input"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      {mode === 'register' && <span className="small-text">Mindestens 6 Zeichen.</span>}
      {error && <Notice tone="warn" title={error} />}
      {info && <Notice tone="info" title={info} />}
      <div className="row">
        <button type="submit" className="btn pri" disabled={busy}>
          {busy ? 'Einen Moment …' : mode === 'login' ? 'Anmelden' : 'Konto anlegen'}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => run(() => auth.signInWithGoogle())}>
          Mit Google anmelden
        </button>
      </div>
      {mode === 'login' && (
        <button
          type="button"
          className="btn compact"
          style={{ justifySelf: 'start', border: 0, paddingLeft: 0, color: 'var(--ac)', background: 'transparent' }}
          disabled={busy}
          onClick={() => {
            if (!email.trim()) return setError('Gib zuerst deine E-Mail-Adresse ein, dann schicken wir dir einen Link.');
            void run(async () => {
              await auth.sendPasswordReset(email);
              setInfo('Wir haben dir eine E-Mail zum Zurücksetzen geschickt.');
            });
          }}
        >
          Passwort vergessen?
        </button>
      )}
    </form>
  );
}

/** Ganze Seite für Bereiche, die eine Anmeldung brauchen. */
export function LoginScreen() {
  return (
    <div className="page" style={{ maxWidth: 520 }}>
      <h1 className="page-title">Anmelden</h1>
      <div className="card">
        <LoginForm intro="Melde dich an, um deine Turniere zu verwalten oder Ergebnisse einzutragen. Zuschauer brauchen kein Konto." />
      </div>
    </div>
  );
}
