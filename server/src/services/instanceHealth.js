// Staying alive, and leaving a trail when memory runs away.
//
// The instance was being killed for exceeding its memory limit, and every
// restart signs the whole team out. Two different jobs here:
//
//   Say what happened.  A kill leaves nothing behind — no stack, no request,
//                       no clue which page caused it. So memory is sampled as
//                       it climbs, and a warning names the requests that were
//                       actually running at the time. The next incident then
//                       points at a route instead of at a mystery.
//
//   Go down tidily.     The platform sends SIGTERM before it restarts or
//                       redeploys. Without a handler, requests in flight are
//                       cut off mid-response — which is what turns a thirty
//                       second deploy into errors on everyone's screen.
const os = require('os');
const v8 = require('v8');
const { containerLimitBytes } = require('../containerLimit');

const MB = 1024 * 1024;
const mb = bytes => Math.round(bytes / MB);

// Everything being served right now, so a memory warning can say what was in
// the building when it happened.
const inFlight = new Map();
let seq = 0;

function trackRequests() {
  return (req, res, next) => {
    const id = ++seq;
    // The path as routed, not as typed: a thousand ids would otherwise read as
    // a thousand different routes and say nothing.
    inFlight.set(id, { method: req.method, url: req.originalUrl.split('?')[0], at: Date.now() });
    res.on('close', () => inFlight.delete(id));
    next();
  };
}

function inFlightSummary() {
  const now = Date.now();
  return [...inFlight.values()]
    .sort((a, b) => a.at - b.at)
    .map(r => `${r.method} ${r.url} (${Math.round((now - r.at) / 1000)}s)`);
}

function memorySnapshot() {
  const m = process.memoryUsage();
  const limit = containerLimitBytes();
  return {
    rss_mb: mb(m.rss),
    heap_used_mb: mb(m.heapUsed),
    heap_total_mb: mb(m.heapTotal),
    // Buffers and the image library live out here, not on the heap — and on
    // this app they are usually the larger half.
    external_mb: mb(m.external + m.arrayBuffers),
    limit_mb: limit ? mb(limit) : null,
    used_pct: limit ? Math.round((m.rss / limit) * 100) : null,
  };
}

// Warn once per step up rather than on every sample, so a service sitting at
// 80% doesn't fill the log with the same line.
const STEPS = [70, 80, 90];
let stepReached = 0;

function checkMemory() {
  const snap = memorySnapshot();
  if (snap.used_pct == null) return snap;

  const step = STEPS.filter(s => snap.used_pct >= s).pop() || 0;
  if (step > stepReached) {
    stepReached = step;
    const running = inFlightSummary();
    console.warn(
      `[memory] ${snap.used_pct}% of the instance limit — ` +
      `rss ${snap.rss_mb}MB of ${snap.limit_mb}MB ` +
      `(heap ${snap.heap_used_mb}MB, off-heap ${snap.external_mb}MB). ` +
      (running.length
        ? `In flight: ${running.join(', ')}`
        : 'Nothing in flight, so this is held rather than being used.')
    );
  } else if (step < stepReached && snap.used_pct < stepReached - 10) {
    // Came back down with room to spare; arm the warnings again.
    stepReached = step;
  }
  return snap;
}

function startMemoryWatch(intervalMs = 30_000) {
  const limit = containerLimitBytes();
  // The cap V8 is actually running under, not the heap it happens to have
  // grown to. Node works this out from the container on its own — on a 512MB
  // instance it settles on about 259MB — so this is a check rather than
  // something that had to be configured. It is also only half the picture:
  // Buffers and the image library are allocated outside the heap entirely and
  // this cap does nothing to hold them, which is why the warnings below count
  // resident memory and not just heap.
  const heapCap = mb(v8.getHeapStatistics().heap_size_limit);
  if (limit) {
    console.log(`Memory: ${mb(limit)}MB instance limit, V8 heap capped at ${heapCap}MB.`);
    if (heapCap > mb(limit)) {
      // Not expected: node sizes the heap from the container by itself. If it
      // ever does not, it will grow past the limit without feeling any
      // pressure, and the process will be killed rather than collect — so it
      // is worth saying out loud rather than discovering from a restart.
      console.warn(
        `Memory: the heap cap (${heapCap}MB) is above the instance limit (${mb(limit)}MB), ` +
        'so V8 may not collect before the platform kills the process. Starting node with ' +
        `--max-old-space-size=${Math.floor(mb(limit) * 0.6)} would hold it below the limit.`);
    }
  } else {
    console.log(`Memory: no container limit here (${mb(os.totalmem())}MB on this machine), V8 heap cap ${heapCap}MB.`);
  }
  const timer = setInterval(checkMemory, intervalMs);
  // Never the reason the process stays up.
  timer.unref();
  return timer;
}

// ── Going down tidily ────────────────────────────────────────────────────────
//
// Render sends SIGTERM and then waits before it sends SIGKILL. Spending that
// time finishing the requests already in progress is the difference between a
// deploy nobody notices and a deploy that puts an error in front of whoever
// was mid-save.
function installShutdownHandlers(server, pool, { graceMs = 15_000 } = {}) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    const running = inFlightSummary();
    console.log(`${signal} received — finishing ${running.length} request(s) then stopping.`);
    if (running.length) console.log(`  ${running.join('\n  ')}`);

    // Stop taking new work, let what is in progress finish.
    server.close(() => console.log('Stopped accepting connections.'));
    // Keep-alive sockets with nothing on them would otherwise hold the server
    // open for the full grace period for no reason.
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();

    const deadline = Date.now() + graceMs;
    while (inFlight.size > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (inFlight.size > 0) {
      console.warn(`Gave up waiting on ${inFlight.size} request(s): ${inFlightSummary().join(', ')}`);
    }

    try { await pool.end(); } catch { /* going down anyway */ }
    console.log('Shutdown complete.');
    process.exit(0);
  }

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => { shutdown(signal); });
  }

  // A crash this process cannot recover from still gets a line saying what
  // memory looked like when it happened, which a kill never does.
  process.on('uncaughtException', err => {
    console.error('Uncaught exception:', err);
    console.error('[memory at crash]', JSON.stringify(memorySnapshot()));
    process.exit(1);
  });
  process.on('unhandledRejection', reason => {
    console.error('Unhandled promise rejection:', reason);
  });

  // Returned so the same path can be driven without a signal — Windows has
  // none, so this is the only way the draining behaviour can be exercised
  // anywhere but the server it runs on.
  return shutdown;
}

module.exports = {
  trackRequests, startMemoryWatch, memorySnapshot, inFlightSummary,
  installShutdownHandlers, checkMemory,
};
