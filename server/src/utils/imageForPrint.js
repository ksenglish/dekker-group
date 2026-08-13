// Shrinking an image to what a page can actually show before it is embedded.
//
// ArcSite exports drawings at very high resolution — 17MB and 20MB PNGs are
// normal. Embedding one of those in a quote is wasteful in three ways at once:
// the bytes are held in memory several times over while the PDF is built, the
// finished PDF is too large to email, and none of that resolution is visible on
// an A4 page anyway.
//
// A4 at 200dpi is about 1654x2339, which is past what any printer will resolve
// from a screen-exported drawing. Scaling to fit that turns a 17MB export into
// a few hundred KB with no visible difference.

const MAX_EDGE = 2400;

// sharp ships prebuilt binaries, but a native module is the most likely thing
// to fail on a deploy. If it does, drawings embed at full size exactly as they
// did before rather than the whole quote failing — worse, but not broken.
let sharp = null;
try {
  sharp = require('sharp');
  // Both of these are tuned for a throughput server on many cores, which this
  // is not — it is a single small instance that resizes an image occasionally.
  // The cache holds decoded images for reuse that never comes, and eight
  // worker threads each take their own working buffers on a one-CPU box.
  // Turning both down cut peak memory for a pair of large drawings by a third.
  sharp.cache(false);
  sharp.concurrency(1);
} catch (err) {
  console.warn('sharp unavailable — drawings will embed at full size:', err.message);
}

const isAvailable = () => Boolean(sharp);

async function shrinkForPage(buffer, mimeType) {
  if (!sharp || !buffer) return buffer;
  // PDFs are pages already, not images — pass them through untouched.
  if (mimeType === 'application/pdf') return buffer;

  try {
    // sequentialRead keeps libvips from holding the whole decoded image where
    // it can avoid it, which matters at the sizes ArcSite exports.
    const image = sharp(buffer, { limitInputPixels: 512 * 1024 * 1024, sequentialRead: true });
    const { width, height } = await image.metadata();
    if (!width || !height) return buffer;
    if (width <= MAX_EDGE && height <= MAX_EDGE && buffer.length < 2 * 1024 * 1024) return buffer;

    // Kept as PNG so line drawings stay sharp — JPEG puts ringing around the
    // hard edges these are almost entirely made of.
    const out = await image
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();

    // A drawing that is mostly photograph can come out larger as a palette PNG
    // than it went in; there is no point taking that trade.
    return out.length < buffer.length ? out : buffer;
  } catch (err) {
    console.warn('Could not resize image, embedding as-is:', err.message);
    return buffer;
  }
}

module.exports = { shrinkForPage, isAvailable, MAX_EDGE };
