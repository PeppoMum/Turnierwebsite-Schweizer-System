// Fehler der Datenschicht mit deutschen, handlungsorientierten Texten (§11).
import { FirebaseError } from 'firebase/app';

export type DataErrorCode =
  | 'revision_conflict'
  | 'not_found'
  | 'permission_denied'
  | 'invalid_input'
  | 'invalid_state'
  | 'invitation_unusable'
  | 'asset_too_large'
  | 'unavailable'
  | 'unknown';

export class DataError extends Error {
  readonly code: DataErrorCode;

  constructor(code: DataErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DataError';
    this.code = code;
  }
}

/**
 * Jemand anderes hat das Dokument seit dem Öffnen geändert (§12 F).
 * `current` enthält den aktuellen Stand für den Konfliktdialog.
 */
export class RevisionConflictError<T = unknown> extends DataError {
  readonly expectedRevision: number;
  readonly actualRevision: number;
  readonly current: T;

  constructor(expectedRevision: number, actualRevision: number, current: T, what = 'Ergebnis') {
    super(
      'revision_conflict',
      `${what} wurde inzwischen geändert. Bitte prüfe den aktuellen Stand und speichere erneut.`,
    );
    this.name = 'RevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
    this.current = current;
  }
}

/** Übersetzt Firestore-Fehler in DataError; DataError wird durchgereicht. */
export function toDataError(err: unknown): DataError {
  if (err instanceof DataError) return err;
  if (err instanceof FirebaseError || (err as { code?: unknown })?.code) {
    const code = String((err as { code: unknown }).code).replace(/^firestore\//, '');
    switch (code) {
      case 'permission-denied':
        return new DataError(
          'permission_denied',
          'Dafür fehlt dir die Berechtigung. Bitte melde dich mit dem richtigen Konto an oder frag die Turnierleitung.',
          { cause: err },
        );
      case 'not-found':
        return new DataError('not_found', 'Der Datensatz wurde nicht gefunden.', { cause: err });
      case 'unavailable':
      case 'deadline-exceeded':
        return new DataError(
          'unavailable',
          'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung und versuche es erneut.',
          { cause: err },
        );
      case 'aborted':
      case 'failed-precondition':
        return new DataError(
          'revision_conflict',
          'Die Daten wurden gleichzeitig geändert. Bitte versuche es erneut.',
          { cause: err },
        );
    }
  }
  return new DataError('unknown', 'Unerwarteter Fehler beim Speichern.', { cause: err });
}

export function notFound(what: string): DataError {
  return new DataError('not_found', `${what} wurde nicht gefunden.`);
}
