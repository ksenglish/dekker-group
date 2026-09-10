// Converts formats a browser can't display into ones it can, on the way in.
//
// iPhones shoot HEIC by default. No browser outside Safari can decode it, so
// the client-side downscaler — which draws the file into a <canvas> — silently
// failed on every HEIC and handed back the untouched original. A 6MB photo
// then tripped the upload size limit and was skipped, which is what the team
// were seeing: "Skipped 3 files still over 5MB after compression".
//
// sharp was meant to do that conversion, and doesn't. Its prebuilt libvips
// reports `format.heif.input.buffer === true`, which is what this file
// originally trusted — but that flag covers the HEIF *container*, and the only
// suffix it actually lists is ".avif". There's no HEVC decoder in the build, so
// every real iPhone/Samsung HEIC fails, and Samsung's fail even earlier on
// libheif's 16-reference iref limit. Both failures were caught and the photo
// stored untouched, which is why .heic files sat in the job showing broken
// thumbnails.
//
// heic-decode (libheif compiled to wasm, with libde265) does the decode
// instead, and sharp handles the resize and JPEG encode from raw pixels. sharp
// is still tried first — it's native and much faster on anything it can read.
//
// Orientation survives: iPhone and Samsung store it as an irot/imir property
// on the HEIF item, and libheif applies that during decode. That matters
// because the raw-pixel handoff carries no EXIF for sharp's .rotate() to read.

let sharp = null;
try {
  sharp = require('sharp');
  // Same tuning as imageForPrint: one small instance, occasional resizes.
  sharp.cache(false);
  sharp.concurrency(1);
} catch (err) {
  console.warn('sharp unavailable — HEIC uploads will be stored as-is:', err.message);
}

let heicDecode = null;
try {
  heicDecode = require('heic-decode');
} catch (err) {
  console.warn('heic-decode unavailable — HEIC uploads will be stored as-is:', err.message);
}

const MAX_EDGE = 2000;
const JPEG_QUALITY = 82;
const PIXEL_LIMIT = 512 * 1024 * 1024;

// Browsers can render these directly, so they're left alone.
const DISPLAYABLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]*)[^,]*,(.*)$/s.exec(dataUrl || '');
  if (!m) return null;
  return { mimeType: m[1] || '', base64: m[2] };
}

// A phone can report an empty type, or application/octet-stream, for a HEIC —
// so the file's own magic bytes are the reliable test. HEIF/HEIC files are
// ISO-BMFF: bytes 4-8 are "ftyp", followed by a brand such as heic/heix/mif1.
function looksLikeHeic(buffer, mimeType = '') {
  if (/hei[cf]|heix|hevc/i.test(mimeType)) return true;
  if (!buffer || buffer.length < 12) return false;
  if (buffer.toString('latin1', 4, 8) !== 'ftyp') return false;
  const brand = buffer.toString('latin1', 8, 12).toLowerCase();
  return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(brand);
}

// Takes a data URL, returns a possibly-converted one plus the mime type to
// store. Never throws: an upload that can't be converted is stored unchanged,
// which is how it behaved before.
async function normaliseImageDataUrl(dataUrl, { maxEdge = MAX_EDGE } = {}) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { dataUrl, mimeType: null, converted: false };

  let buffer;
  try { buffer = Buffer.from(parsed.base64, 'base64'); }
  catch { return { dataUrl, mimeType: parsed.mimeType, converted: false }; }

  const isHeic = looksLikeHeic(buffer, parsed.mimeType);
  // Anything a browser can already show is left exactly as the client sent it —
  // the client has usually downscaled it already.
  if (!isHeic && DISPLAYABLE.has(parsed.mimeType)) {
    return { dataUrl, mimeType: parsed.mimeType, converted: false };
  }
  if (!isHeic || !sharp) return { dataUrl, mimeType: parsed.mimeType, converted: false };

  const out = await heicToJpeg(buffer, maxEdge);
  if (!out) return { dataUrl, mimeType: parsed.mimeType, converted: false };
  return {
    dataUrl: `data:image/jpeg;base64,${out.toString('base64')}`,
    mimeType: 'image/jpeg',
    converted: true,
    originalBytes: buffer.length,
    bytes: out.length,
  };
}

// Returns a JPEG buffer, or null if nothing here could read the file. Exported
// so the backfill script converts the already-stored photos the same way.
async function heicToJpeg(buffer, maxEdge = MAX_EDGE) {
  if (!sharp) return null;

  const encode = pipeline => pipeline
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  try {
    // .rotate() honours the EXIF orientation before it's discarded.
    return await encode(sharp(buffer, { limitInputPixels: PIXEL_LIMIT, sequentialRead: true }).rotate());
  } catch (err) {
    if (!heicDecode) {
      console.warn('HEIC conversion failed, storing original:', err.message);
      return null;
    }
  }

  try {
    // A 12MP photo decodes to roughly 48MB of RGBA, so this is deliberately one
    // image at a time — uploads arrive sequentially from the client anyway.
    const { width, height, data } = await heicDecode({ buffer });
    return await encode(sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }));
  } catch (err) {
    console.warn('HEIC conversion failed, storing original:', err.message);
    return null;
  }
}

// Filenames follow the bytes — a converted file called photo.heic would still
// download as something nothing opens.
function normaliseFilename(filename, converted) {
  if (!converted || !filename) return filename;
  return String(filename).replace(/\.(heic|heif|hif)$/i, '.jpg');
}

module.exports = {
  normaliseImageDataUrl, normaliseFilename, looksLikeHeic, heicToJpeg,
  isSharpAvailable: () => Boolean(sharp),
};
