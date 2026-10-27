// Bilder (Wappen, Logos, Sponsoren) im Spark-Tarif: im Browser verkleinern und komprimieren,
// dann als kleine Data-URL in eigenen Asset-Dokumenten speichern (§10.2). Kein Cloud Storage,
// keine großen Base64-Felder im Turnierdokument. Die Regeln erzwingen dieselben Grenzen.
import {
  doc,
  getCountFromServer,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { DataError, toDataError } from './errors';
import type { AssetKind, AssetMimeType } from './model';
import { paths } from './paths';

/** Max. Binärgröße eines Bildes nach Kompression. */
export const MAX_ASSET_BYTES = 40 * 1024;
/** Max. Länge der Data-URL (Base64 von 40 KiB + Präfix); identisch in den Regeln. */
export const MAX_DATA_URL_LENGTH = 55_000;
/** Max. Kantenlänge in Pixeln (Regeln erlauben bis 1024). */
export const MAX_ASSET_DIMENSION = 512;
/** Max. Bilder je Turnier (clientseitig geprüft). */
export const MAX_ASSETS_PER_TOURNAMENT = 50;

export const ALLOWED_INPUT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export interface PreparedAsset {
  dataUrl: string;
  mimeType: AssetMimeType;
  width: number;
  height: number;
}

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/;

/** Binärgröße einer Base64-Data-URL. */
export function dataUrlBytes(dataUrl: string): number {
  const match = DATA_URL.exec(dataUrl);
  if (!match) return Number.NaN;
  const b64 = match[2]!;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length * 3) / 4 - padding;
}

/** Prüft ein vorbereitetes Bild gegen die Grenzen und liefert seine Größe in Bytes. */
export function validateAsset(asset: PreparedAsset): number {
  const match = DATA_URL.exec(asset.dataUrl);
  if (!match || match[1] !== asset.mimeType) {
    throw new DataError('invalid_input', 'Bitte ein PNG-, JPEG- oder WebP-Bild verwenden.');
  }
  const bytes = dataUrlBytes(asset.dataUrl);
  if (asset.dataUrl.length > MAX_DATA_URL_LENGTH || bytes > MAX_ASSET_BYTES) {
    throw new DataError(
      'asset_too_large',
      `Das Bild ist nach dem Verkleinern noch ${Math.ceil(bytes / 1024)} KB groß (erlaubt: ${MAX_ASSET_BYTES / 1024} KB). Bitte ein einfacheres Logo verwenden.`,
    );
  }
  const okDim = (n: number) => Number.isInteger(n) && n > 0 && n <= 1024;
  if (!okDim(asset.width) || !okDim(asset.height)) {
    throw new DataError('invalid_input', 'Ungültige Bildabmessungen.');
  }
  return bytes;
}

/**
 * Verkleinert und komprimiert ein Bild im Browser. Transparenz bleibt erhalten (WebP oder
 * PNG); undurchsichtige Bilder dürfen als JPEG enden. SVG wird abgelehnt (Skript-Risiko).
 */
export async function compressImage(
  file: Blob,
  options: { maxDimension?: number; maxBytes?: number } = {},
): Promise<PreparedAsset> {
  const maxDimension = options.maxDimension ?? MAX_ASSET_DIMENSION;
  const maxBytes = options.maxBytes ?? MAX_ASSET_BYTES;
  if (!(ALLOWED_INPUT_TYPES as readonly string[]).includes(file.type)) {
    throw new DataError('invalid_input', 'Bitte ein PNG-, JPEG-, WebP- oder GIF-Bild auswählen.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const hasAlpha = file.type !== 'image/jpeg' && bitmapHasAlpha(bitmap);
    for (const scale of [1, 0.75, 0.5, 0.35, 0.25]) {
      const longest = Math.max(bitmap.width, bitmap.height);
      const factor = Math.min(1, maxDimension / longest) * scale;
      const width = Math.max(1, Math.round(bitmap.width * factor));
      const height = Math.max(1, Math.round(bitmap.height * factor));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
      const candidates: Array<[AssetMimeType, number | undefined]> = hasAlpha
        ? [['image/webp', 0.9], ['image/webp', 0.75], ['image/png', undefined]]
        : [['image/webp', 0.85], ['image/jpeg', 0.85], ['image/jpeg', 0.7]];
      for (const [type, quality] of candidates) {
        const dataUrl = canvas.toDataURL(type, quality);
        // Browser ohne WebP-Encoder liefern stillschweigend PNG.
        if (!dataUrl.startsWith(`data:${type};`)) continue;
        if (dataUrlBytes(dataUrl) <= maxBytes && dataUrl.length <= MAX_DATA_URL_LENGTH) {
          return { dataUrl, mimeType: type, width, height };
        }
      }
    }
  } finally {
    bitmap.close();
  }
  throw new DataError(
    'asset_too_large',
    'Das Bild lässt sich nicht klein genug komprimieren. Bitte ein einfacheres Logo verwenden.',
  );
}

function bitmapHasAlpha(bitmap: ImageBitmap): boolean {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
  return false;
}

/**
 * Speichert ein Bild als Asset. `isPublic` legt zusätzlich eine öffentliche Kopie an
 * (Wappen, Teamlogos und Sponsoren sind für Gäste sichtbar). Liefert die Asset-ID.
 */
export async function saveAsset(
  db: Firestore,
  tid: string,
  asset: PreparedAsset,
  kind: AssetKind,
  options: { isPublic: boolean; assetId?: string },
): Promise<string> {
  const bytes = validateAsset(asset);
  try {
    if (!options.assetId) {
      const count = await getCountFromServer(paths.assets(db, tid));
      if (count.data().count >= MAX_ASSETS_PER_TOURNAMENT) {
        throw new DataError(
          'asset_too_large',
          `Pro Turnier sind höchstens ${MAX_ASSETS_PER_TOURNAMENT} Bilder möglich. Bitte nicht mehr benötigte Bilder entfernen.`,
        );
      }
    }
    const ref = options.assetId ? paths.asset(db, tid, options.assetId) : doc(paths.assets(db, tid));
    const data = {
      ...asset,
      bytes,
      kind,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const batch = writeBatch(db);
    batch.set(ref, data as never);
    const publicRef = paths.publicAsset(db, tid, ref.id);
    if (options.isPublic) batch.set(publicRef, data as never);
    else batch.delete(publicRef);
    await batch.commit();
    return ref.id;
  } catch (err) {
    throw toDataError(err);
  }
}

export async function deleteAsset(db: Firestore, tid: string, assetId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(paths.asset(db, tid, assetId));
  batch.delete(paths.publicAsset(db, tid, assetId));
  try {
    await batch.commit();
  } catch (err) {
    throw toDataError(err);
  }
}
