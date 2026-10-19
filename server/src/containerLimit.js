// How much memory this instance is actually allowed, read from the container.
//
// Needed because "how much memory is there" has two different answers inside a
// container: the machine's, which is large, and the limit the platform will
// kill the process for exceeding, which is not. Only the second one matters,
// and os.totalmem() reports the first.
//
// This is what the memory warnings are measured against. Read from the
// container rather than written down, so moving to a bigger or smaller
// instance needs no change and the figure cannot be left pointing at a size
// that used to be true.
const fs = require('fs');
const os = require('os');

// cgroup v2 first, then v1. A container with no limit reports "max".
const CGROUP_FILES = [
  '/sys/fs/cgroup/memory.max',                   // v2
  '/sys/fs/cgroup/memory/memory.limit_in_bytes', // v1
];

// The limit in bytes, or null when this isn't a limited container — a
// developer machine, mostly.
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

module.exports = { containerLimitBytes };
