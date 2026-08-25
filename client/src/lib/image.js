// Client-side image downscaling, used before anything is uploaded.
//
// Files are stored as base64 in Postgres, so an untouched 4MB phone photo
// costs several megabytes of database for something only ever viewed at
// screen size. Scaling to a sane edge length first cuts that by roughly an
// order of magnitude.
//
// Three things this deliberately protects against:
//   - Non-images (PDFs, CSVs) pass straight through untouched.
//   - Images with transparency re-encode as PNG, not JPEG — flattening a
//     logo's alpha onto a canvas would give it a black background.
//   - If re-encoding somehow produces a *bigger* payload (common for small
//     flat-colour PNGs), the original is kept.

export const MAX_PHOTO_EDGE = 1400;
export const DEFAULT_QUALITY = 0.8;

// Vector stays sharp at any size and is already tiny; animation would be
// flattened to a single frame. Neither belongs in a raster resize.
const SKIP_TYPES = new Set(['image/svg+xml', 'image/gif']);

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// JPEG can't carry alpha, so only formats that might are worth scanning.
function hasTransparency(ctx, width, height, sourceType) {
  if (sourceType === 'image/jpeg' || sourceType === 'image/jpg') return false;
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    // A tainted canvas can't be read — assume alpha and keep PNG, which is
    // lossless either way.
    return true;
  }
}

export function isImage(file) {
  return (file?.type || '').startsWith('image/');
}

// iPhones shoot HEIC. Only Safari can decode it, so drawing one into a canvas
// fails everywhere else and the file comes back untouched — which used to mean
// a 6MB photo hit the size limit and got skipped. These are handed straight to
// the server, which converts them with sharp.
export function needsServerConversion(file) {
  const type = (file?.type || '').toLowerCase();
  if (/hei[cf]/.test(type)) return true;
  // Android often reports an empty or generic type for a HEIC, so fall back
  // to the extension.
  return /\.(heic|heif|hif)$/i.test(file?.name || '');
}

// Returns { dataUrl, mimeType, compressed, serverWillConvert, originalBytes, bytes }.
// Never throws — on any failure the untouched original comes back, because
// losing someone's site photo to a resize bug is far worse than storing it big.
export async function compressImage(file, { maxEdge = MAX_PHOTO_EDGE, quality = DEFAULT_QUALITY } = {}) {
  const original = await fileToDataUrl(file);
  const sourceType = file.type || '';
  const result = {
    dataUrl: original,
    mimeType: sourceType,
    compressed: false,
    serverWillConvert: false,
    originalBytes: dataUrlBytes(original),
    bytes: dataUrlBytes(original),
  };
  if (needsServerConversion(file)) return { ...result, serverWillConvert: true };
  if (!sourceType.startsWith('image/') || SKIP_TYPES.has(sourceType)) return result;

  try {
    const img = await loadImage(original);
    // A format the browser can't decode (some HEICs report as image/*) — let
    // the server deal with it rather than skipping the photo.
    if (!img.width || !img.height) return { ...result, serverWillConvert: true };

    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const outType = hasTransparency(ctx, canvas.width, canvas.height, sourceType)
      ? 'image/png'
      : 'image/jpeg';
    const out = canvas.toDataURL(outType, quality);

    if (!out || out.length >= original.length) return result;
    return {
      dataUrl: out,
      mimeType: outType,
      compressed: true,
      originalBytes: result.originalBytes,
      bytes: dataUrlBytes(out),
    };
  } catch {
    // Decode failed outright — same story, hand it to the server.
    return { ...result, serverWillConvert: true };
  }
}

// Decoded byte count of a data URL, ignoring the "data:...;base64," prefix.
export function dataUrlBytes(dataUrl) {
  if (!dataUrl) return 0;
  const comma = dataUrl.indexOf(',');
  const b64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(b64.length * 3 / 4) - padding);
}
