// How much heap V8 is allowed, printed for the start command to pass in.
//
// The instance was being killed for exceeding its memory limit, which takes
// every signed-in session down with it. The reason is that V8 decides how hard
// to garbage-collect from how much memory it thinks it has, and left alone it
// looks at the *host*, not at the container it is boxed into. On a machine with
// plenty of RAM it sees no reason to collect, grows past the container's much
// smaller limit, and the platform kills it — V8 never feeling any pressure at
// all.
//
// Telling it the real ceiling turns that around: it collects as it approaches
// the limit instead of sailing through it, and the process stays up.
//
// The ceiling is read from the container itself rather than written down here,
// so moving to a bigger or smaller instance needs no change and cannot be left
// pointing at a number that used to be true.
const fs = require('fs');
const os = require('os');

// cgroup v2 first, then v1. A container with no limit reports "max".
const CGROUP_FILES = [
  '/sys/fs/cgroup/memory.max',                  // v2
  '/sys/fs/cgroup/memory/memory.limit_in_bytes', // v1
];

// What the platform will kill us for exceeding, in bytes, or null if this
// isn't a limited container (a laptop, mostly).
function containerLimitBytes() {
  for (const file of CGROUP_FILES) {
    try {
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (raw === 'max') continue;
      const bytes = Number(raw);
      // v1 reports an enormous sentinel rather than "max" when unlimited, so
      // anything at or above the machine's own RAM is not a real limit.
      if (Number.isFinite(bytes) && bytes > 0 && bytes < os.totalmem()) return bytes;
    } catch { /* not readable here; try the next one */ }
  }
  return null;
}

// The share of the container V8 may use for its heap.
//
// The rest is not spare — it is the Node binary itself, every Buffer (which
// lives outside the heap), and sharp, whose image decoding is done by a C
// library that allocates outside the heap entirely. Those are exactly what a
// PDF full of photographs spends its memory on, so the margin has to be wide
// enough to hold them or the cap achieves nothing.
const HEAP_SHARE = 0.6;
const MIN_MB = 192;   // below this nothing useful runs
const MAX_MB = 4096;  // above this the cap stops being the thing that matters

function heapBudgetMb() {
  const limit = containerLimitBytes();
  // No container limit means a developer machine, where V8's own default is
  // already sensible and a cap would only get in the way.
  if (!limit) return null;
  const mb = Math.floor((limit / 1024 / 1024) * HEAP_SHARE);
  return Math.max(MIN_MB, Math.min(MAX_MB, mb));
}

module.exports = { heapBudgetMb, containerLimitBytes };

// Printed for the start command. Nothing on a machine with no limit, which
// leaves the flag off rather than passing it an empty value.
if (require.main === module) {
  const mb = heapBudgetMb();
  process.stdout.write(mb ? `--max-old-space-size=${mb}` : '');
}
