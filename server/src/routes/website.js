// ── Website editing ───────────────────────────────────────────────────────────
// Backs the Website section in Dekker App: edit the marketing site's content as
// a draft, preview it, then publish. Everything here needs a login; the site
// itself reads the published copy through /api/public/website.
const router = require('express').Router();
const multer = require('multer');
const pool = require('../db/pool');
const { authenticate, requireRole, authenticateAutomation } = require('../middleware/auth');
const content = require('../services/websiteContent');
const media = require('../services/websiteMedia');
const publishing = require('../services/websitePublish');
const jobs = require('../services/websiteJobs');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Shared with the worker, which writes the same content — see
// services/websiteNormalisers.
const NORMALISERS = require('../services/websiteNormalisers');
// Only keys the app knows how to edit — stops arbitrary content keys appearing.
const EDITABLE_KEYS = Object.keys(NORMALISERS);
const checkKey = (req, res, next) =>
  EDITABLE_KEYS.includes(req.params.key) ? next() : res.status(404).json({ error: 'Unknown content' });

const clip = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));

// ── The worker's endpoints ───────────────────────────────────────────────────
// automation/website-worker.js runs on a machine the business controls and
// authenticates with AUTOMATION_API_KEY, the same way the invoice processor
// does. These sit above the login check on purpose; everything below it needs a
// signed-in person.
router.post('/jobs/claim', authenticateAutomation, requireRole('admin'), async (req, res) => {
  try {
    await jobs.noteWorkerSeen();
    await jobs.releaseAbandoned();
    const job = await jobs.claimNext();
    if (!job) return res.json({ job: null });

    // The content the app owns travels with the job, so the worker can hand it
    // to Claude Code as editable files without needing its own credentials for
    // a second round trip.
    const appContent = {};
    for (const key of EDITABLE_KEYS) appContent[key] = (await content.getContent(key)).draft;

    res.json({ job: { id: job.id, instruction: job.instruction }, appContent });
  } catch (err) { console.error('Job claim failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.post('/jobs/:id/finish', authenticateAutomation, requireRole('admin'), async (req, res) => {
  const { status, result, commits, log, appContent } = req.body || {};
  try {
    // Content the worker changed goes through the same validators the editing
    // forms use, and lands in the draft. Publishing stays a separate, human
    // decision. A validation failure is reported rather than swallowed, so the
    // job does not claim success on a change that never saved.
    const rejected = [];
    for (const [key, value] of Object.entries(appContent || {})) {
      if (!NORMALISERS[key]) { rejected.push(`${key} is not editable`); continue; }
      try {
        await content.saveDraft(key, NORMALISERS[key](value), null);
      } catch (err) { rejected.push(`${key}: ${err.message}`); }
    }

    const job = await jobs.finish(req.params.id, {
      status: rejected.length ? 'failed' : status,
      result: rejected.length ? `${result || ''}\n\nNot saved — ${rejected.join('; ')}`.trim() : result,
      commits, log,
    });
    if (!job) return res.status(404).json({ error: 'No such job, or it was not running' });
    res.json({ ok: true, rejected });
  } catch (err) { console.error('Job finish failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.use(authenticate);

const shape = row => ({
  key: row.key,
  draft: row.draft,
  published: row.published,
  updatedAt: row.updated_at,
  publishedAt: row.published_at,
  hasUnpublishedChanges: content.hasUnpublishedChanges(row),
});

router.get('/content/:key', checkKey, async (req, res) => {
  try {
    const row = await content.getContent(req.params.key);
    res.json({ ...shape(row), previewToken: await content.getPreviewToken() });
  } catch (err) {
    console.error('GET website content failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/content/:key', checkKey, requireRole('admin', 'office'), async (req, res) => {
  // Validation problems are the editor's to fix and are worth reporting back
  // verbatim. Anything the database objects to is ours, and gets a generic
  // message rather than raw Postgres text.
  let value;
  try {
    value = NORMALISERS[req.params.key](req.body?.value);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not save' });
  }

  try {
    res.json(shape(await content.saveDraft(req.params.key, value, req.user.id)));
  } catch (err) {
    console.error('Saving website content failed:', err.message);
    res.status(500).json({ error: 'Could not save — please try again' });
  }
});

router.post('/content/:key/publish', checkKey, requireRole('admin', 'office'), async (req, res) => {
  try {
    res.json(shape(await content.publish(req.params.key, req.user.id)));
  } catch (err) {
    console.error('Publish failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/content/:key/revert', checkKey, requireRole('admin', 'office'), async (req, res) => {
  try {
    res.json(shape(await content.revertDraft(req.params.key, req.user.id)));
  } catch (err) {
    console.error('Revert failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Media ────────────────────────────────────────────────────────────────────
router.get('/media', async (req, res) => {
  try { res.json(await media.list()); }
  catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/media', requireRole('admin', 'office'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const row = await media.store({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      userId: req.user.id,
    });
    res.status(201).json({ ...row, url: `/api/public/website/media/${row.id}` });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not process that image' });
  }
});

router.delete('/media/:id', requireRole('admin', 'office'), async (req, res) => {
  try {
    const ok = await media.remove(req.params.id);
    res.status(ok ? 204 : 404).end();
  } catch (err) { console.error('Website route failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

// ── Preview & publish ────────────────────────────────────────────────────────
// Website changes sit on a staging branch with its own preview build until
// someone publishes them to the live site.
router.get('/publish/status', async (req, res) => {
  try {
    res.json(await publishing.status());
  } catch (err) {
    console.error('Website publish status failed:', err.message);
    res.status(500).json({ error: 'Could not reach GitHub' });
  }
});

router.post('/publish', requireRole('admin'), async (req, res) => {
  try {
    const result = await publishing.publish(req.user?.name || req.user?.email);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('Website publish failed:', err.message);
    res.status(500).json({ error: 'Could not publish' });
  }
});

// ── Change requests ──────────────────────────────────────────────────────────
// A queue of things to change on the site. Any one of them can be handed to the
// chat below, which is what actually makes the change.
router.get('/requests', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.name AS created_by_name
         FROM website_requests r
         LEFT JOIN users u ON u.id = r.created_by
        ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                 r.created_at DESC`
    );
    res.json(rows);
  } catch (err) { console.error('Website route failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.post('/requests', async (req, res) => {
  const { title, details, page, mediaId } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error: 'A short title is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO website_requests (title, details, page, media_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [clip(title, 255), clip(details, 5000), clip(page, 255), mediaId || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error('Website route failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.patch('/requests/:id', async (req, res) => {
  const { status } = req.body || {};
  if (!['open', 'in_progress', 'done', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Unknown status' });
  }
  // Worked out here rather than with a CASE in the statement: reusing one
  // parameter as both a varchar assignment and a text comparison makes Postgres
  // give up with "inconsistent types deduced for parameter $2".
  const resolvedAt = ['done', 'dismissed'].includes(status) ? new Date() : null;

  try {
    const { rows } = await pool.query(
      `UPDATE website_requests
          SET status = $2, resolved_at = $3
        WHERE id = $1 RETURNING *`,
      [req.params.id, status, resolvedAt]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Updating website request failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/requests/:id', requireRole('admin', 'office'), async (req, res) => {
  try {
    await pool.query('DELETE FROM website_requests WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { console.error('Website route failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

// ── Website jobs ─────────────────────────────────────────────────────────────
// Describe a change here and a worker running Claude Code makes it, on the
// staging branch. The app never calls an AI itself — see services/websiteJobs
// for why that matters — so this is a queue plus somewhere to read the answer.
const jobRoutes = requireRole('admin', 'office');

const shapeJob = row => ({
  id: row.id,
  instruction: row.instruction,
  status: row.status,
  result: row.result,
  commits: row.commits || [],
  requestId: row.request_id,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
  createdByName: row.created_by_name || null,
});

router.get('/jobs', jobRoutes, async (req, res) => {
  try {
    // Clearing out jobs whose worker died is cheap and this is the page that
    // would show them, so it happens on the way past rather than on a timer.
    await jobs.releaseAbandoned();
    const { rows } = await pool.query(
      `SELECT j.*, u.name AS created_by_name
         FROM website_jobs j LEFT JOIN users u ON u.id = j.created_by
        ORDER BY j.created_at DESC LIMIT 40`
    );
    res.json({
      jobs: rows.map(shapeJob),
      worker: await jobs.workerStatus(),
      previewUrl: publishing.PREVIEW_URL,
    });
  } catch (err) { console.error('Website jobs route failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.post('/jobs', jobRoutes, async (req, res) => {
  const { requestId } = req.body || {};
  let instruction = String(req.body?.instruction || '').trim();
  try {
    // Queuing from a logged request reuses what was already written there, so
    // nobody retypes it.
    if (requestId && !instruction) {
      const { rows } = await pool.query('SELECT title, details, page FROM website_requests WHERE id = $1', [requestId]);
      if (!rows[0]) return res.status(404).json({ error: 'That request no longer exists' });
      instruction = [rows[0].title, rows[0].page ? `Page: ${rows[0].page}` : null, rows[0].details]
        .filter(Boolean).join('\n\n');
    }
    if (!instruction) return res.status(400).json({ error: 'Describe what you want changed' });

    const { rows } = await pool.query(
      `INSERT INTO website_jobs (instruction, request_id, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [instruction.slice(0, 5000), requestId || null, req.user.id]
    );
    if (requestId) {
      await pool.query(`UPDATE website_requests SET status='in_progress' WHERE id=$1 AND status='open'`, [requestId]);
    }
    res.status(201).json(shapeJob(rows[0]));
  } catch (err) { console.error('Website jobs route failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/jobs/:id', jobRoutes, async (req, res) => {
  try {
    // Only something not yet picked up can be called off. A job already in
    // Claude Code's hands has to run its course.
    const { rows } = await pool.query(
      `UPDATE website_jobs SET status='cancelled', finished_at=NOW()
        WHERE id=$1 AND status='queued' RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(409).json({ error: 'That one has already started' });
    res.status(204).end();
  } catch (err) { console.error('Website jobs route failed:', err.message); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
