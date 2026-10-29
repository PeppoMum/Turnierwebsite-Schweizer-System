import { useId, useState } from 'react';
import { imageToDataUrl } from '../image';
import { Crest } from './ui';

export function ImagePicker({
  label,
  value,
  name,
  onChange,
  choices,
}: {
  label: string;
  value?: string;
  name: string;
  onChange: (dataUrl: string | undefined) => void;
  /** Schon hochgeladene Bilder (z. B. Wappen anderer Mannschaften desselben Vereins) zum Übernehmen. */
  choices?: Array<{ logo: string; name: string }>;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const others = (choices ?? []).filter((c) => c.logo !== value);
  return (
    <div className="field">
      <span className="label">
        <label htmlFor={id}>{label}</label>
      </span>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <Crest name={name || '?'} logo={value} />
        <input
          id={id}
          className="input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          aria-invalid={error ? true : undefined}
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            try {
              onChange(await imageToDataUrl(file));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Das Bild ging nicht.');
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }}
        />
        {value && (
          <button type="button" className="btn" onClick={() => onChange(undefined)}>
            Entfernen
          </button>
        )}
      </div>
      {others.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small-text">Oder ein schon hochgeladenes Wappen nehmen:</span>
          <div className="row crest-choices">
            {others.map((c) => (
              <button
                key={c.logo}
                type="button"
                className="btn crest-choice"
                title={c.name}
                aria-label={`Wappen von ${c.name} nehmen`}
                onClick={() => onChange(c.logo)}
              >
                <Crest name={c.name} logo={c.logo} />
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

/** Verschiedene Wappen der Mannschaften, je Bild einmal (mit dem ersten Mannschaftsnamen). */
export function crestChoices(teams: Array<{ name: string; logo?: string }>): Array<{ logo: string; name: string }> {
  const seen = new Map<string, string>();
  for (const t of teams) if (t.logo && !seen.has(t.logo)) seen.set(t.logo, t.name);
  return [...seen].map(([logo, name]) => ({ logo, name }));
}
