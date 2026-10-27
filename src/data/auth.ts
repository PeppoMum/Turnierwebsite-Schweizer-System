// Anmeldung für Turnierleitung und Helfer (Firebase Authentication). Zuschauer brauchen kein Konto.
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
} from 'firebase/auth';
import type { Actor } from './audit';
import { DataError } from './errors';

/** Quelle der angemeldeten Person; im Test durch eine feste Person ersetzbar. */
export interface ActorSource {
  current(): Actor | null;
  onChange(listener: (actor: Actor | null) => void): () => void;
}

export function firebaseActorSource(auth: Auth): ActorSource {
  const toActor = () =>
    auth.currentUser && !auth.currentUser.isAnonymous
      ? { uid: auth.currentUser.uid, email: auth.currentUser.email }
      : null;
  return {
    current: toActor,
    onChange: (listener) => onAuthStateChanged(auth, () => listener(toActor())),
  };
}

function authError(err: unknown): DataError {
  const code = String((err as { code?: unknown })?.code ?? '');
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'E-Mail oder Passwort stimmen nicht.',
    'auth/wrong-password': 'E-Mail oder Passwort stimmen nicht.',
    'auth/user-not-found': 'E-Mail oder Passwort stimmen nicht.',
    'auth/invalid-email': 'Bitte gib eine gültige E-Mail-Adresse ein.',
    'auth/email-already-in-use': 'Für diese E-Mail gibt es schon ein Konto. Bitte melde dich an.',
    'auth/weak-password': 'Das Passwort ist zu kurz. Bitte nimm mindestens 6 Zeichen.',
    'auth/too-many-requests': 'Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.',
    'auth/popup-closed-by-user': 'Die Anmeldung wurde abgebrochen.',
    'auth/network-request-failed': 'Keine Verbindung. Bitte prüfe deine Internetverbindung.',
  };
  return new DataError('permission_denied', messages[code] ?? 'Die Anmeldung hat nicht geklappt.', {
    cause: err,
  });
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw authError(err);
  }
}

export const signInWithEmail = (auth: Auth, email: string, password: string) =>
  wrap(() => signInWithEmailAndPassword(auth, email.trim(), password));

export const registerWithEmail = (auth: Auth, email: string, password: string) =>
  wrap(() => createUserWithEmailAndPassword(auth, email.trim(), password));

export const signInWithGoogle = (auth: Auth) => wrap(() => signInWithPopup(auth, new GoogleAuthProvider()));

export const sendPasswordReset = (auth: Auth, email: string) =>
  wrap(() => sendPasswordResetEmail(auth, email.trim()));

export const signOut = (auth: Auth) => wrap(() => firebaseSignOut(auth));
