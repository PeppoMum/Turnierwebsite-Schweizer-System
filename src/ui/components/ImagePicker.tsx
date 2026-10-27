import { useId, useState } from 'react';
import { imageToDataUrl } from '../image';
import { Crest } from './ui';

export function ImagePicker({
  label,
  value,
  name,
  onChange,
}: {
  label: string;
  value?: string;
  name: string;
  onChange: (dataUrl: string | undefined) => void;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
