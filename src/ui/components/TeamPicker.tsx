// Mannschaft wählen: aufklappen und antippen oder Namen eintippen (Combobox nach WAI-ARIA).
import { useId, useRef, useState } from 'react';
import { Icon } from './Icon';
import { TeamName } from './ui';

export interface PickerTeam {
  id: string;
  name: string;
  logo?: string;
}

export function TeamPicker({
  teams,
  value,
  onChange,
  label,
  allLabel,
  placeholder = 'Mannschaft wählen oder eintippen',
}: {
  teams: PickerTeam[];
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  /** Eintrag für „keine Auswahl“, z. B. „Alle Mannschaften“. Ohne ihn gibt es keinen solchen Eintrag. */
  allLabel?: string;
  placeholder?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const selected = value ? teams.find((t) => t.id === value) : undefined;
  const q = (query ?? '').trim().toLowerCase();
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const matches = sorted.filter((t) => !q || t.name.toLowerCase().includes(q));
  const options: Array<PickerTeam | null> = [...(allLabel && !q ? [null] : []), ...matches];

  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const pick = (team: PickerTeam | null) => {
    onChange(team?.id ?? null);
    close();
  };
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div
        className="picker"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
        }}
      >
        <span className="picker-icon" aria-hidden>
          <Icon name="search" />
        </span>
        <input
          ref={inputRef}
          id={id}
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options.length > 0 ? optionId(active) : undefined}
          autoComplete="off"
          value={query ?? selected?.name ?? ''}
          placeholder={selected ? selected.name : (allLabel ?? placeholder)}
          onFocus={(e) => {
            setOpen(true);
            e.target.select();
          }}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && open && options.length > 0) {
              e.preventDefault();
              pick(options[Math.min(active, options.length - 1)] ?? null);
            } else if (e.key === 'Escape') {
              close();
            }
          }}
        />
        <button
          type="button"
          className="picker-toggle"
          aria-label={open ? 'Liste schließen' : 'Liste öffnen'}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) close();
            else {
              setOpen(true);
              inputRef.current?.focus();
            }
          }}
        >
          <Icon name={open ? 'up' : 'down'} />
        </button>
        {open && (
          <div id={listId} className="picker-list" role="listbox" aria-label={label}>
            {options.length === 0 && <span className="picker-empty">Keine Mannschaft gefunden.</span>}
            {options.map((t, i) => (
              <button
                key={t?.id ?? '__all'}
                id={optionId(i)}
                type="button"
                role="option"
                aria-selected={(t?.id ?? null) === value}
                className={i === active ? 'menu-item active' : 'menu-item'}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(t)}
              >
                {t ? <TeamName name={t.name} logo={t.logo} /> : <span>{allLabel}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
