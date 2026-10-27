// Bilder im Browser verkleinern, bevor sie gespeichert werden (Spezifikation §10.2).
export const MAX_ASSET_BYTES = 40 * 1024;
const MAX_EDGE = 256;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];

export async function imageToDataUrl(file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) {
    throw new Error('Dieses Format geht nicht. Nimm bitte PNG, JPG, WebP oder SVG.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Die Datei ist größer als 10 MB. Nimm bitte ein kleineres Bild.');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Das Bild lässt sich nicht öffnen.'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth || MAX_EDGE, img.naturalHeight || MAX_EDGE));
    const w = Math.max(1, Math.round((img.naturalWidth || MAX_EDGE) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || MAX_EDGE) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Das Bild lässt sich nicht verarbeiten.');
    ctx.drawImage(img, 0, 0, w, h);
    // WebP behält Transparenz und ist klein; PNG als Rückfall.
    for (const q of [0.9, 0.75, 0.6]) {
      const out = canvas.toDataURL('image/webp', q);
      if (out.startsWith('data:image/webp') && out.length * 0.75 <= MAX_ASSET_BYTES) return out;
    }
    const png = canvas.toDataURL('image/png');
    if (png.length * 0.75 <= MAX_ASSET_BYTES) return png;
    throw new Error('Das Bild ist auch verkleinert noch zu groß. Nimm bitte ein einfacheres Logo.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
