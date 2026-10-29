// „Mein Team“: pro Turnier auf diesem Gerät gemerkt, ohne Anmeldung. Ohne Speicher (privates Fenster)
// bleibt die Wahl bis zum Neuladen.
import { useCallback, useSyncExternalStore } from 'react';

const FAV_KEY = 'turnier-fav-';
const EVENT = 'turnier-fav';
const memory = new Map<string, string | null>();

export function readFav(tid: string): string | null {
  if (memory.has(tid)) return memory.get(tid)!;
  try {
    return localStorage.getItem(FAV_KEY + tid);
  } catch {
    return null;
  }
}

export function writeFav(tid: string, id: string | null): void {
  memory.set(tid, id);
  try {
    if (id) localStorage.setItem(FAV_KEY + tid, id);
    else localStorage.removeItem(FAV_KEY + tid);
  } catch {
    // nur im Speicher dieser Seite
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Gemerktes Team; alle Stellen der Seite sehen sofort dieselbe Wahl. */
export function useFavorite(tid: string): [string | null, (id: string | null) => void] {
  const fav = useSyncExternalStore(subscribe, () => readFav(tid));
  const set = useCallback((id: string | null) => writeFav(tid, id), [tid]);
  return [fav, set];
}
