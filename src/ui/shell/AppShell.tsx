// App-Rahmen: schwarze Leiste oben (Tablet, Computer), schwebende Leiste unten am Handy.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, Seg } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { useTheme, type ThemeChoice } from '../theme';

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  href: string;
  active: boolean;
}

export interface MoreItem {
  key: string;
  label: string;
  icon: IconName;
  href?: string;
  onSelect?: () => void;
  active?: boolean;
}

function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <Seg<ThemeChoice>
      label="Darstellung"
      full
      value={theme}
      onChange={setTheme}
      options={[
        { value: 'auto', label: 'Automatisch' },
        { value: 'light', label: 'Hell' },
        { value: 'dark', label: 'Dunkel' },
      ]}
    />
  );
}

function MoreList({ items, onPick }: { items: MoreItem[]; onPick: () => void }) {
  return (
    <>
      {items.map((m) =>
        m.href ? (
          <a key={m.key} className="menu-item" href={m.href} aria-current={m.active ? 'page' : undefined} onClick={onPick}>
            <Icon name={m.icon} />
            {m.label}
          </a>
        ) : (
          <button
            key={m.key}
            type="button"
            className="menu-item"
            onClick={() => {
              onPick();
              m.onSelect?.();
            }}
          >
            <Icon name={m.icon} />
            {m.label}
          </button>
        ),
      )}
    </>
  );
}

export function AppShell({
  brand,
  brandHref,
  items,
  more = [],
  children,
}: {
  brand: string;
  brandHref: string;
  items: NavItem[];
  more?: MoreItem[];
  children: ReactNode;
}) {
  const [popOpen, setPopOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setPopOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPopOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popOpen]);

  // Am Handy höchstens fünf Plätze, der letzte ist „Mehr“.
  const tabItems = items.slice(0, 4);
  const overflow: MoreItem[] = [...items.slice(4).map((i) => ({ ...i })), ...more];
  const moreActive = items.slice(4).some((i) => i.active);

  return (
    <div className="app">
      <header className="topnav">
        <div className="inner">
          <a className="brand" href={brandHref}>
            {brand}
          </a>
          <nav aria-label="Hauptmenü">
            {items.map((i) => (
              <a key={i.key} className="nav-item" href={i.href} aria-current={i.active ? 'page' : undefined}>
                {i.label}
              </a>
            ))}
          </nav>
          <div className="tools">
            <div ref={popRef} style={{ position: 'relative' }} className="desk-only">
              <button
                type="button"
                className="nav-item"
                aria-expanded={popOpen}
                aria-haspopup="menu"
                onClick={() => setPopOpen((o) => !o)}
              >
                Mehr ▾
              </button>
              {popOpen && (
                <div className="menu-pop" role="menu">
                  <MoreList items={more} onPick={() => setPopOpen(false)} />
                  <div style={{ padding: '6px 4px 2px' }}>
                    <span className="small-text" style={{ display: 'block', marginBottom: 4 }}>
                      Darstellung
                    </span>
                    <ThemeSwitch />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="app-main" id="inhalt">
        {children}
      </main>

      <nav className="tabbar" aria-label="Hauptmenü">
        {tabItems.map((i) => (
          <a key={i.key} className="tab" href={i.href} aria-current={i.active ? 'page' : undefined}>
            <Icon name={i.icon} />
            <span>{i.label}</span>
          </a>
        ))}
        <button type="button" className="tab" aria-current={moreActive ? 'page' : undefined} onClick={() => setSheetOpen(true)}>
          <Icon name="more" />
          <span>Mehr</span>
        </button>
      </nav>

      {sheetOpen && (
        <Dialog title="Mehr" onClose={() => setSheetOpen(false)}>
          {overflow.length > 0 && (
            <div className="stack tight">
              <MoreList items={overflow} onPick={() => setSheetOpen(false)} />
            </div>
          )}
          <div className="field">
            <span className="label">Darstellung</span>
            <ThemeSwitch />
          </div>
        </Dialog>
      )}
    </div>
  );
}
