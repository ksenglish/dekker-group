// The queue between "someone asked for a website change" and "Claude Code made
// it".
//
// Nothing in this file talks to an AI. The work happens in automation/
// website-worker.js, which runs Claude Code on a machine the business already
// pays a subscription for; the app's side of the arrangement is a queue, a
// heartbeat, and somewhere to write the answer back to. That split is the
// reason this costs nothing per change.
const pool = require('../db/pool');

// How long after the worker's last check-in to call it offline. It polls every
// 30 seconds, so this tolerates a few missed rounds before saying anything —
// the message exists to stop someone typing into a void when the machine is
// off, not to report every hiccup.
const WORKER_STALE_MS = 5 * 60 * 1000;
const SEEN_KEY = 'website_worker_seen';

async function noteWorkerSeen() {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SEEN_KEY, JSON.stringify({ at: new Date().toISOString() })]
  );
}

async function workerStatus() {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [SEEN_KEY]);
  const at = rows[0]?.value?.at || null;
  if (!at) return { online: false, lastSeen: null, everRun: false };
  return { online: Date.now() - new Date(at).getTime() < WORKER_STALE_MS, lastSeen: at, everRun: true };
}

// Handing out work. The UPDATE picks the job itself rather than a select
// followed by a write, so two workers started by mistake cannot both walk away
// with the same job.
async function claimNext() {
  const { rows } = await pool.query(
    `UPDATE website_jobs SET status = 'running', claimed_at = NOW()
      WHERE id = (
        SELECT id FROM website_jobs WHERE status = 'queued'
        ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING *`
  );
  return rows[0] || null;
}

async function finish(id, { status, result, commits, log }) {
  const { rows } = await pool.query(
    `UPDATE website_jobs
        SET status = $2, result = $3, commits = $4, log = $5, finished_at = NOW()
      WHERE id = $1 AND status = 'running'
      RETURNING *`,
    [id, status === 'done' ? 'done' : 'failed', result || null,
     JSON.stringify(commits || []), log ? String(log).slice(0, 20000) : null]
  );
  const job = rows[0];

  // A finished job closes the request it came from, so the Change Requests tab
  // does not keep showing work that has already been done.
  if (job?.request_id && job.status === 'done') {
    await pool.query(
      `UPDATE website_requests SET status='done', resolved_at=NOW() WHERE id=$1 AND status <> 'done'`,
      [job.request_id]
    );
  }
  return job;
}

// A job left 'running' when the worker's machine was shut down mid-change would
// otherwise sit there forever, and block nothing but confuse everyone. Anything
// claimed more than half an hour ago is given up on.
async function releaseAbandoned() {
  const { rowCount } = await pool.query(
    `UPDATE website_jobs
        SET status = 'failed', finished_at = NOW(),
            result = 'The worker stopped before this finished. Check the preview, then queue it again.'
      WHERE status = 'running' AND claimed_at < NOW() - INTERVAL '30 minutes'`
  );
  return rowCount;
}

module.exports = { claimNext, finish, releaseAbandoned, noteWorkerSeen, workerStatus };
