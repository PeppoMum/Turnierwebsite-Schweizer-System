// Firebase-Initialisierung aus Vite-Umgebungsvariablen (.env.example).
// Mit VITE_USE_FIREBASE_EMULATOR=true verbindet sich die App mit den lokalen Emulatoren
// (Ports aus firebase.json), ein echtes Firebase-Projekt ist dann nicht nötig.
import { initializeApp, getApps, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

export const EMULATOR_HOST = '127.0.0.1';
export const EMULATOR_PORTS = { auth: 9099, firestore: 8080 } as const;

export interface FirebaseServices {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  usingEmulator: boolean;
}

export function readFirebaseConfig(env: Record<string, string | undefined>): {
  options: FirebaseOptions;
  useEmulator: boolean;
} {
  const useEmulator = env.VITE_USE_FIREBASE_EMULATOR === 'true';
  const projectId = env.VITE_FIREBASE_PROJECT_ID || (useEmulator ? 'demo-turnier' : undefined);
  if (!projectId) {
    throw new Error(
      'Firebase ist nicht konfiguriert: VITE_FIREBASE_PROJECT_ID fehlt. Siehe firebase/README.md.',
    );
  }
  if (!useEmulator && !env.VITE_FIREBASE_API_KEY) {
    throw new Error(
      'Firebase ist nicht konfiguriert: VITE_FIREBASE_API_KEY fehlt. Siehe firebase/README.md.',
    );
  }
  return {
    useEmulator,
    options: {
      // Der Auth-Emulator akzeptiert jeden API-Key.
      apiKey: env.VITE_FIREBASE_API_KEY || 'demo-api-key',
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || undefined,
      projectId,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
      appId: env.VITE_FIREBASE_APP_ID || undefined,
    },
  };
}

let services: FirebaseServices | undefined;

/** Liefert die (einmalig initialisierten) Firebase-Dienste der App. */
export function getFirebase(): FirebaseServices {
  if (services) return services;
  const { options, useEmulator } = readFirebaseConfig(
    import.meta.env as unknown as Record<string, string | undefined>,
  );
  const app = getApps()[0] ?? initializeApp(options);
  const db = getFirestore(app);
  const auth = getAuth(app);
  if (useEmulator) {
    connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore);
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, {
      disableWarnings: true,
    });
  }
  services = { app, db, auth, usingEmulator: useEmulator };
  return services;
}
