// The queue between "someone asked for a change to the app" and "Claude Code
// made it".
//
// Nothing in this file talks to an AI. The work happens in
// automation/app-worker.js, which runs Claude Code on a machine the business
// already pays a subscription for; the app's side is a queue, a heartbeat, and
// somewhere to write the answer back to. That split is why this costs nothing
// per change — the same arrangement the Website section already uses.
const pool = require('../db/pool');
const fileStore = require('./fileStore');

// How long after the worker's last check-in to call it offline. It polls every
// 30 seconds, so this tolerates a few missed rounds — the message exists to
// stop someone typing into a void when the machine is off.
const WORKER_STALE_MS = 5 * 60 * 1000;
const SEEN_KEY = 'app_worker_seen';

// `authed` is whether Claude Code can sign in on the worker machine. A worker
// that is running but signed out looks identical to one that is working, and
// the office would sit waiting on a queue nothing is being taken off.
async function noteWorkerSeen(authed) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SEEN_KEY, JSON.stringify({ at: new Date().toISOString(), authed: authed !== false })]
  );
}

async function workerStatus() {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [SEEN_KEY]);
  const at = rows[0]?.value?.at || null;
  if (!at) return { online: false, lastSeen: null, everRun: false, authed: true };
  return {
    online: Date.now() - new Date(at).getTime() < WORKER_STALE_MS,
    lastSeen: at, everRun: true,
    authed: rows[0]?.value?.authed !== false,
  };
}

// Handing out work. The UPDATE picks the job itself rather than a select
// followed by a write, so two workers started by mistake cannot both walk away
// with the same job.
async function claimNext() {
  const { rows } = await pool.query(
    `UPDATE app_jobs SET status = 'running', claimed_at = NOW()
      WHERE id = (
        SELECT id FROM app_jobs WHERE status = 'queued'
        ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING *`
  );
  return rows[0] || null;
}

async function finish(id, { status, result, commits, checks, log, branch }) {
  const { rows } = await pool.query(
    `UPDATE app_jobs
        SET status = $2, result = $3, commits = $4, checks = $5, log = $6,
            branch = COALESCE($7, branch), finished_at = NOW()
      WHERE id = $1 AND status = 'running'
      RETURNING *`,
    [id, status === 'done' ? 'done' : 'failed', result || null,
     JSON.stringify(commits || []), JSON.stringify(checks || []),
     log ? String(log).slice(0, 20000) : null, branch || null]
  );
  return rows[0] || null;
}

// The pictures of the screen afterwards. Stored the way every other upload in
// the app is: the bucket where one is configured, inline otherwise.
async function saveShots(jobId, shots) {
  const saved = [];
  for (const [i, shot] of (shots || []).entries()) {
    if (!shot?.data_base64) continue;
    const stored = await fileStore.storeDataUrl({
      prefix: `app-jobs/${jobId}`, filename: `shot-${i + 1}.png`, dataUrl: shot.data_base64,
    });
    const { rows } = await pool.query(
      `INSERT INTO app_job_shots (job_id, caption, mime_type, storage_key, data_base64, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [jobId, shot.caption ? String(shot.caption).slice(0, 255) : null,
       shot.data_base64.match(/^data:([^;]+)/)?.[1] || 'image/png',
       stored?.key || null, stored ? null : shot.data_base64, i]
    );
    saved.push(rows[0].id);
  }
  return saved;
}

// A job left 'running' when the worker's machine was shut down mid-change would
// otherwise sit there forever, confusing everyone. Anything claimed more than
// half an hour ago is given up on.
async function releaseAbandoned() {
  const { rowCount } = await pool.query(
    `UPDATE app_jobs
        SET status = 'failed', finished_at = NOW(),
            result = 'The worker stopped before this finished. Nothing was published. Queue it again.'
      WHERE status = 'running' AND claimed_at < NOW() - INTERVAL '30 minutes'`
  );
  return rowCount;
}

async function list(limit = 25) {
  const { rows } = await pool.query(
    `SELECT j.*, u.name AS created_by_name, p.name AS published_by_name,
            (SELECT COUNT(*)::int FROM app_job_shots s WHERE s.job_id = j.id) AS shot_count
       FROM app_jobs j
       LEFT JOIN users u ON u.id = j.created_by
       LEFT JOIN users p ON p.id = j.published_by
      ORDER BY j.created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function get(id) {
  const { rows: [job] } = await pool.query(
    `SELECT j.*, u.name AS created_by_name, p.name AS published_by_name
       FROM app_jobs j
       LEFT JOIN users u ON u.id = j.created_by
       LEFT JOIN users p ON p.id = j.published_by
      WHERE j.id = $1`,
    [id]
  );
  if (!job) return null;
  const { rows: shots } = await pool.query(
    'SELECT id, caption, sort_order FROM app_job_shots WHERE job_id = $1 ORDER BY sort_order',
    [id]
  );
  return { ...job, shots };
}

module.exports = {
  claimNext, finish, saveShots, releaseAbandoned,
  noteWorkerSeen, workerStatus, list, get,
};
