import CODE128B from 'jsbarcode/bin/barcodes/CODE128/CODE128B.js';

// Draws our own printed stock labels as Code 128.
//
// The encoding comes from jsbarcode rather than being written out here. A
// hand-written pattern table is easy to get subtly wrong in a way that still
// looks right — the label prints, and only fails when someone tries to scan a
// box on site. Only the drawing is ours, from the bit string the encoder
// returns: '1' is a bar, '0' a space.

export function code128Svg(text, { moduleWidth = 2, height = 60 } = {}) {
  if (!text) return null;

  let bits;
  try {
    const encoder = new (CODE128B.default || CODE128B)(String(text), {});
    if (!encoder.valid()) return null;
    bits = encoder.encode().data;
  } catch {
    return null;
  }

  const width = bits.length * moduleWidth;
  const rects = [];

  // Emit one <rect> per run of bars rather than per module, so a label is a
  // few dozen shapes instead of a few hundred.
  let runStart = null;
  for (let i = 0; i <= bits.length; i++) {
    const isBar = bits[i] === '1';
    if (isBar && runStart === null) runStart = i;
    if (!isBar && runStart !== null) {
      rects.push(
        `<rect x="${runStart * moduleWidth}" y="0" width="${(i - runStart) * moduleWidth}" height="${height}" fill="#000"/>`
      );
      runStart = null;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="#fff"/>${rects.join('')}</svg>`;
}
