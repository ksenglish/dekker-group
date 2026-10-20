// Shrinking a product picture before it is stored.
//
// A price list imported from a supplier's website brings a photograph for
// every product, and the same photograph again for every size that product
// comes in. Kept as JPEG that ran to 120MB for one supplier; as WebP it is
// about 40% less, and the pictures are indistinguishable at the sizes they
// are ever shown — a 36pt thumbnail on a quote, or an 80px box in the editor.
//
// Deliberately NOT applied to everything that gets stored. ArcSite exports are
// line drawings, where a lossy format puts fringing along every edge, and they
// already have their own handling in imageForPrint. This is for product
// photographs, which is where the volume is.
const { sniff } = require('./pdfImage');

let sharp = null;
try {
  sharp = require('sharp');
} catch {
  // Without it, pictures are stored exactly as they arrive — which is what
  // happened before this existed.
}

const MAX_EDGE = 1200;   // beyond what a quote thumbnail or the editor shows
const QUALITY = 80;

function parse(dataUrl) {
  const s = String(dataUrl || '');
  const m = s.match(/^data:([^;]+);base64,(.*)$/s);
  if (!m) return null;
  try {
    return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
  } catch { return null; }
}

// A data URL to store, given one that arrived. Returns the original untouched
// when there is nothing to gain or nothing to do it with.
async function toStoredImage(dataUrl) {
  if (!sharp) return dataUrl;
  const parsed = parse(dataUrl);
  if (!parsed || !parsed.buffer.length) return dataUrl;

  // Read from the bytes, not the declared type. The ZIP importer calls
  // everything that is not .png a JPEG, so the declared type is the one piece
  // of information here that is known to lie.
  const kind = sniff(parsed.buffer);
  if (kind === null || kind === 'other') return dataUrl;   // not an image we know; leave it alone
  // Already in the format and roughly the size this would produce, so there is
  // nothing to gain and a re-encode would only lose a little quality. Also
  // makes this safe to call twice on the same value, which the import path
  // does — it converts each file once up front and then once more per row.
  if (kind === 'webp' && parsed.buffer.length <= 400 * 1024) return dataUrl;

  try {
    const out = await sharp(parsed.buffer)
      // Honours the EXIF orientation before it is discarded, so a photo taken
      // in portrait does not end up on its side.
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
    // A picture that is already smaller than what WebP would make of it is
    // kept as it is — some tiny logos encode larger.
    if (out.length >= parsed.buffer.length) return dataUrl;
    return `data:image/webp;base64,${out.toString('base64')}`;
  } catch (err) {
    console.warn('Could not convert a product image, storing as-is:', err.message);
    return dataUrl;
  }
}

module.exports = { toStoredImage };
