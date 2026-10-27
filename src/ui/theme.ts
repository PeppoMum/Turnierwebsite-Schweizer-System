// Hell/Dunkel: standardmäßig wie das Gerät, auf Wunsch fest gewählt.
import { useCallback, useSyncExternalStore } from 'react';

export type ThemeChoice = 'auto' | 'light' | 'dark';
const KEY = 'turnier-theme';
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(choice: ThemeChoice = read()): void {
  const root = document.documentElement;
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const choice = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
  );
  const set = useCallback((c: ThemeChoice) => {
    try {
      if (c === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {
      // ohne Speicher gilt die Wahl nur bis zum Neuladen
    }
    applyTheme(c);
    listeners.forEach((l) => l());
  }, []);
  return [choice, set];
}
