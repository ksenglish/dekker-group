// Deciding whether a barcode the camera thinks it read is worth believing.
//
// A phone camera reading a crinkled plastic bag in daylight gets it wrong
// often, and the wrong answer does not look wrong: it is a run of digits like
// any other. One got as far as being offered as a new product —
//
//   printed on the bag   9351871000059   (EAN-13)
//   what came back        310501000059   (12 digits)
//
// — which shares its last seven digits with the real code, is shorter, has an
// even number of digits, and passes a check digit. That is a partial read of
// the same bars decoded as Interleaved 2 of 5: ITF has almost no start and
// stop pattern to speak of and no length it must be, so part of an EAN symbol
// decodes as a shorter ITF number perfectly happily. The check digit matching
// as well was luck — one in ten.
//
// So three things have to agree before a scan is acted on: the format is one
// we actually use, the check digit is right, and the same value came back from
// more than one frame.

// What is on the things this business scans: maker barcodes off a box are
// EAN/UPC, our own printed labels are Code 128.
//
// ITF and Codabar are deliberately absent. Nothing here is labelled with
// either, and both will happily decode a fragment of some other symbol into a
// plausible number — which is the whole bug.
export const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];

const digitsOnly = s => /^\d+$/.test(s);

// GS1 check digit, for every length that uses one: weights run 3, 1, 3, 1…
// leftwards from the digit beside the check digit, so EAN-8, UPC-A, EAN-13 and
// ITF-14 are all the same sum.
export function checkDigitOk(code) {
  const s = String(code || '');
  if (!digitsOnly(s) || s.length < 8) return false;
  const want = Number(s[s.length - 1]);
  let sum = 0;
  for (let i = s.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(s[i]) * w;
  return (10 - (sum % 10)) % 10 === want;
}

// Whether a decode is worth believing at all.
//
// A numeric code claiming to be a retail barcode has to be a length one of
// them actually is, and has to pass its check digit. Code 128 and Code 39 are
// not checked: they carry whatever was printed on them, including our own
// labels, and have their own built-in character validation.
const RETAIL_LENGTHS = new Set([8, 12, 13, 14]);

export function looksReal(code, format) {
  const s = String(code || '').trim();
  if (!s) return false;
  if (format && (format.startsWith('code_') || format === 'qr_code')) return s.length >= 3;
  if (!digitsOnly(s)) return true;             // a letters-and-digits code is our own
  if (!RETAIL_LENGTHS.has(s.length)) return false;
  return checkDigitOk(s);
}

// The same product's barcode written the other way round.
//
// A UPC-A and the EAN-13 with a zero in front of it are one barcode, and which
// one you get back depends on the phone. A product labelled with one must be
// found by a scan that reports the other, or the same box reads as two
// different products depending on who is holding it.
export function barcodeVariants(code) {
  const s = String(code || '').trim();
  const out = [s];
  if (!digitsOnly(s)) return out;
  if (s.length === 12) out.push(`0${s}`);
  if (s.length === 13 && s.startsWith('0')) out.push(s.slice(1));
  // A 14-digit shipping code is the retail one with a packaging level in
  // front. Scanning an outer carton should still find the product inside it.
  if (s.length === 14 && s.startsWith('0')) out.push(s.slice(1));
  return [...new Set(out)];
}
