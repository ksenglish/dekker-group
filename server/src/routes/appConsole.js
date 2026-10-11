// ── The app's own change console ─────────────────────────────────────────────
// Backs the App Updates section: the office asks for a change in their own
// words, a worker on a machine the business controls makes it with Claude Code,
// and the evidence comes back here to be read before anyone publishes.
//
// Nothing in this file talks to an AI. It holds the queue and the answers.
const router = require('express').Router();
const pool = require('../db/pool');
const { authenticate, requireRole, authenticateAutomation } = require('../middleware/auth');
const jobs = require('../services/appJobs');
const publishing = require('../services/appPublish');
const fileStore = require('../services/fileStore');

// ── The worker's endpoints ───────────────────────────────────────────────────
// automation/app-worker.js authenticates with AUTOMATION_API_KEY, the same way
// the website worker and the invoice processor do. These sit above the login
// check on purpose; everything below it needs a signed-in person.
router.post('/jobs/claim', authenticateAutomation, requireRole('admin'), async (req, res) => {
  try {
    await jobs.noteWorkerSeen();
    await jobs.releaseAbandoned();
    const job = await jobs.claimNext();
    if (!job) return res.json({ job: null });
    // The branch is decided here rather than by the worker, so the name is
    // predictable from the job and two workers cannot pick the same one.
    const branch = `app-change/${job.id.slice(0, 8)}`;
    await pool.query('UPDATE app_jobs SET branch = $1 WHERE id = $2', [branch, job.id]);
    res.json({ job: { id: job.id, instruction: job.instruction, branch } });
  } catch (err) { console.error('App job claim failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

// Claiming is the worker's only other check-in, and it does not claim while it
// is busy — so on a long job the app would say the worker had gone, mid-change.
// This is the liveness signal on its own, sent on a timer whatever it is doing.
router.post('/jobs/heartbeat', authenticateAutomation, requireRole('admin'), async (req, res) => {
  try {
    await jobs.noteWorkerSeen();
    res.json({ ok: true });
  } catch (err) { console.error('App heartbeat failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.post('/jobs/:id/finish', authenticateAutomation, requireRole('admin'), async (req, res) => {
  const { status, result, commits, checks, log, branch, shots } = req.body || {};
  try {
    const job = await jobs.finish(req.params.id, { status, result, commits, checks, log, branch });
    if (!job) return res.status(404).json({ error: 'No such job, or it was not running' });
    // Screenshots are saved after the job is marked finished: a picture that
    // fails to store should not turn a change that worked into a failure.
    let saved = [];
    try { saved = await jobs.saveShots(job.id, shots); }
    catch (err) { console.error('App job screenshots failed:', err.message); }
    res.json({ ok: true, shots: saved.length });
  } catch (err) { console.error('App job finish failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.use(authenticate);

// ── Reading the queue ────────────────────────────────────────────────────────
// Anyone at office level can queue work and read what came back. Publishing is
// narrower — see below.
const consoleRoles = requireRole('admin', 'office');

router.get('/worker', consoleRoles, async (req, res) => {
  try { res.json(await jobs.workerStatus()); }
  catch { res.status(500).json({ error: 'Server error' }); }
});

router.get('/jobs', consoleRoles, async (req, res) => {
  try { res.json(await jobs.list(Number(req.query.limit) || 25)); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/jobs/:id', consoleRoles, async (req, res) => {
  try {
    const job = await jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(job);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/jobs', consoleRoles, async (req, res) => {
  const instruction = String(req.body?.instruction || '').trim();
  if (!instruction) return res.status(400).json({ error: 'Say what you would like changed' });
  if (instruction.length > 4000) return res.status(400).json({ error: 'That is too long — keep it under 4000 characters' });
  try {
    const { rows: [job] } = await pool.query(
      'INSERT INTO app_jobs (instruction, created_by) VALUES ($1,$2) RETURNING *',
      [instruction, req.user?.id || null]
    );
    res.status(201).json(job);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Only a job nobody has started. One already running is the worker's, and
// cancelling it here would leave the branch half-made.
router.delete('/jobs/:id', consoleRoles, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE app_jobs SET status='cancelled', finished_at=NOW()
        WHERE id=$1 AND status='queued' RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(400).json({ error: 'That job has already been picked up' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// A screenshot from the run. Fetched through the API because the bucket is not
// public, the same as every other stored file.
router.get('/jobs/:id/shots/:shotId', consoleRoles, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT mime_type, storage_key, data_base64 FROM app_job_shots WHERE id=$1 AND job_id=$2',
      [req.params.shotId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const buf = await fileStore.readBytes({ key: rows[0].storage_key, inline: rows[0].data_base64 });
    res.set('Content-Type', rows[0].mime_type || 'image/png');
    res.send(buf);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Publishing ───────────────────────────────────────────────────────────────
// What a change actually does to the business is why this is narrower than
// queuing it: a wording fix and a change to how GST is worked out arrive
// through the same box. Admin signs it off.

router.get('/jobs/:id/publish-status', consoleRoles, async (req, res) => {
  try {
    const job = await jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(await publishing.status(job.branch));
  } catch (err) {
    console.error('App publish status failed:', err.message);
    res.status(500).json({ error: 'Could not reach GitHub' });
  }
});

router.post('/jobs/:id/publish', requireRole('admin'), async (req, res) => {
  try {
    const job = await jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (job.status === 'published') return res.status(400).json({ error: 'That change has already been published' });
    if (job.status !== 'done') return res.status(400).json({ error: 'Only a finished change can be published' });

    const result = await publishing.publish(job.branch, req.user?.name || req.user?.email);
    if (!result.ok) return res.status(400).json({ error: result.error });

    await pool.query(
      `UPDATE app_jobs SET status='published', published_at=NOW(), published_by=$2 WHERE id=$1`,
      [job.id, req.user?.id || null]
    );
    res.json(result);
  } catch (err) {
    console.error('App publish failed:', err.message);
    res.status(500).json({ error: 'Could not publish' });
  }
});

module.exports = router;
