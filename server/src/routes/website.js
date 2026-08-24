// ── Website editing ───────────────────────────────────────────────────────────
// Backs the Website section in Dekker App: edit the marketing site's content as
// a draft, preview it, then publish. Everything here needs a login; the site
// itself reads the published copy through /api/public/website.
const router = require('express').Router();
const multer = require('multer');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const content = require('../services/websiteContent');
const media = require('../services/websiteMedia');
const publishing = require('../services/websitePublish');
const discounts = require('../utils/calculatorDiscounts');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.use(authenticate);

// Only keys the app knows how to edit — stops arbitrary content keys appearing.
const EDITABLE_KEYS = ['deals', discounts.CONTENT_KEY];
const checkKey = (req, res, next) =>
  EDITABLE_KEYS.includes(req.params.key) ? next() : res.status(404).json({ error: 'Unknown content' });

const clip = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Deals arrive from a form, so everything is clipped and the expiry is checked
// — a bad date here would silently hide a live promotion.
function normaliseDeals(input) {
  if (!Array.isArray(input)) throw new Error('Deals must be a list');
  return input.map((d, i) => {
    if (!d || !String(d.title || '').trim()) throw new Error(`Deal ${i + 1} needs a title`);
    if (d.expires && !DATE_RE.test(d.expires)) throw new Error(`Deal ${i + 1} has an invalid expiry date`);
    return {
      id: clip(d.id, 100) || `deal-${i + 1}-${Date.now()}`,
      badge: clip(d.badge, 60),
      title: clip(d.title, 200),
      price: clip(d.price, 60),
      priceNote: clip(d.priceNote, 60),
      image: clip(d.image, 600),
      imageAlt: clip(d.imageAlt, 300),
      hook: clip(d.hook, 400),
      body: clip(d.body, 2000),
      terms: clip(d.terms, 1000),
      service: clip(d.service, 60),
      expires: d.expires || null,
    };
  });
}

const NORMALISERS = {
  deals: normaliseDeals,
  [discounts.CONTENT_KEY]: discounts.normalise,
};

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
// A queue of things to change on the site. It records work; it cannot start it.
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

module.exports = router;
