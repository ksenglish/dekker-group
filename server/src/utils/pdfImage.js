// Making sure an image is one pdfkit can actually draw.
//
// doc.image() understands JPEG and PNG and nothing else. Hand it anything
// else and it throws — and because every call site wraps that in a catch so
// one bad picture cannot fail a whole quote, the picture simply is not there.
// No error, no log, just a quote that goes to a customer with a blank where
// the product photo should be. That is the worst way for this to fail, so
// anything that is not already JPEG or PNG is converted before it gets near
// the page.
//
// The type is read from the bytes rather than from a declared mime type. A
// declared type is exactly what cannot be trusted here: the price-list
// importer labels every image that is not .png as image/jpeg, so a WebP
// arrives claiming to be a JPEG and would sail straight through a check that
// believed it.

let sharp = null;
try {
  sharp = require('sharp');
} catch {
  // Converting is then impossible, and a JPEG or PNG still passes through
  // untouched — which is every image stored before this existed.
}

// The first bytes of the formats pdfkit can draw.
function sniff(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  // RIFF....WEBP
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  return 'other';
}

function toBuffer(input) {
  if (!input) return null;
  if (Buffer.isBuffer(input)) return input;
  const s = String(input);
  const base64 = s.startsWith('data:') ? s.replace(/^data:[^;]*;base64,/, '') : s;
  try {
    const b = Buffer.from(base64, 'base64');
    return b.length ? b : null;
  } catch { return null; }
}

// A buffer pdfkit will accept, or null if there is nothing usable here.
//
// Already-drawable formats are returned exactly as they came: re-encoding a
// JPEG to a JPEG costs time and a little quality for no gain at all.
async function toPdfImage(input) {
  const buffer = toBuffer(input);
  if (!buffer) return null;

  const kind = sniff(buffer);
  if (kind === 'jpeg' || kind === 'png') return buffer;
  if (!sharp) return null;   // cannot convert; the caller skips it

  try {
    // Flattened onto white, because a WebP or PNG with transparency becomes
    // black where it was see-through once it is a JPEG.
    return await sharp(buffer)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch (err) {
    console.warn('Could not convert an image for the PDF:', err.message);
    return null;
  }
}

// The same thing for a whole list, in one pass. Used for the product rows and
// the appendix drawings, both of which are arrays that get drawn in a
// synchronous loop and so have to be ready before it starts.
async function toPdfImages(inputs) {
  return Promise.all((inputs || []).map(i => toPdfImage(i)));
}

module.exports = { toPdfImage, toPdfImages, sniff };
