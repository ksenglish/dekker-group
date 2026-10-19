// Keeping image work inside the instance's memory limit.
//
// sharp does its decoding in libvips, a C library, so none of what it uses
// shows up as heap and none of it is subject to garbage collection — it is
// simply allocated, and the platform kills the instance when there is too much
// of it. Two of its defaults are sized for a machine rather than a container:
//
//   cache       libvips keeps finished operations and their pixel buffers
//               around in case the same work comes again. For a price list
//               where every thumbnail is a different picture that is tens of
//               megabytes held for nothing.
//
//   concurrency one worker per CPU, each decoding a whole image at once. A
//               photo off a phone is about 48MB once decoded — small as a
//               JPEG, enormous as pixels — so four at a time is most of a
//               small instance gone on a single upload.
//
// Neither is about how fast one image is converted; they are about how many
// are in flight and how much is kept afterwards. Turning them down costs a
// little wall-clock time on a busy moment and takes the spike away.
let configured = false;

function configureImageMemory() {
  if (configured) return null;
  configured = true;
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    // Image conversion is already optional in several places here — the
    // callers fall back when it isn't available, so this is not fatal.
    return null;
  }
  sharp.cache(false);
  sharp.concurrency(1);
  // libvips holds a pool of per-thread buffers; without this they are kept for
  // the life of the process even when nothing is converting.
  if (typeof sharp.simd === 'function') sharp.simd(true);
  return { concurrency: sharp.concurrency(), cache: sharp.cache() };
}

module.exports = { configureImageMemory };
