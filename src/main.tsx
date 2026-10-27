import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { firebaseActorSource, getFirebase } from './data';
import { FirestoreTournamentStore } from './ui/data/firestoreStore';
import { FirebaseAuthService } from './ui/data/firebaseAuth';

const root = document.getElementById('root');
if (!root) throw new Error('Root-Element #root fehlt in index.html');

// VITE_DATA_SOURCE=firebase: echte Datenhaltung mit Anmeldung (Emulator oder Firebase-Projekt).
// Sonst Beispieldaten im Browser ohne Anmeldung.
function services() {
  if (import.meta.env.VITE_DATA_SOURCE !== 'firebase') return {};
  const { db, auth } = getFirebase();
  return {
    service: new FirestoreTournamentStore(db, firebaseActorSource(auth)),
    auth: new FirebaseAuthService(auth, db),
  };
}

createRoot(root).render(
  <StrictMode>
    <App {...services()} />
  </StrictMode>,
);
