const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const fileStore = require('../services/fileStore');

// Keep in step with FIELD_TYPES in client/src/lib/formFields.js
const FIELD_TYPES = ['section', 'text', 'textarea', 'number', 'date', 'select', 'checkbox', 'yesno', 'signoff', 'photo'];
const STAGES = ['pre_install', 'post_install'];

// Templates are authored by admins but every role has to be able to read them
// to fill a form in on site.
router.use(authenticate);

function validateFields(fields) {
  if (!Array.isArray(fields)) return 'Fields must be a list';
  const ids = new Set();
  for (const f of fields) {
    if (!f || typeof f !== 'object') return 'Each field must be an object';
    if (!f.id) return 'Each field needs an id';
    if (ids.has(f.id)) return `Duplicate field id "${f.id}"`;
    ids.add(f.id);
    if (!FIELD_TYPES.includes(f.type)) return `Unknown field type "${f.type}"`;
    if (!String(f.label || '').trim()) return 'Every field needs a label';
    if (f.type === 'select' && (!Array.isArray(f.options) || f.options.filter(o => String(o).trim()).length === 0)) {
      return `"${f.label}" is a dropdown, so it needs at least one option`;
    }
  }
  return null;
}

router.get('/templates', async (req, res) => {
  const { stage, include_archived } = req.query;
  const conds = [];
  const params = [];
  if (stage) { conds.push(`stage = $${params.length + 1}`); params.push(stage); }
  if (include_archived !== 'true') conds.push('NOT archived');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  try {
    const { rows } = await pool.query(
      `SELECT t.*, (SELECT COUNT(*) FROM job_form_submissions s WHERE s.template_id = t.id) AS submission_count
       FROM form_templates t ${where} ORDER BY t.sort_order, t.name`,
      params
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/templates', requireRole('admin', 'office'), async (req, res) => {
  const { name, description, stage, fields } = req.body;
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required' });
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  const fieldError = validateFields(fields || []);
  if (fieldError) return res.status(400).json({ error: fieldError });
  try {
    const { rows: [{ next_order }] } = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM form_templates'
    );
    const { rows } = await pool.query(
      `INSERT INTO form_templates (name, description, stage, fields, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name.trim(), description || null, stage, JSON.stringify(fields || []), next_order]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/templates/:id', requireRole('admin', 'office'), async (req, res) => {
  const { name, description, stage, fields, archived, sort_order } = req.body;
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (stage !== undefined && !STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  if (fields !== undefined) {
    const fieldError = validateFields(fields);
    if (fieldError) return res.status(400).json({ error: fieldError });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE form_templates SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         stage = COALESCE($3, stage),
         fields = COALESCE($4, fields),
         archived = COALESCE($5, archived),
         sort_order = COALESCE($6, sort_order),
         updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [name ?? null, description ?? null, stage ?? null,
       fields !== undefined ? JSON.stringify(fields) : null,
       archived ?? null, sort_order ?? null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Form not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/templates/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*) FROM job_form_submissions WHERE template_id = $1', [req.params.id]
    );
    if (parseInt(count) > 0) {
      // Deleting would take completed records of work with it, so it's blocked.
      return res.status(400).json({
        error: `This form has been filled in on ${count} job${count === '1' ? '' : 's'}. Archive it instead — it'll stop appearing on new jobs but the completed ones stay intact.`,
      });
    }
    const { rowCount } = await pool.query('DELETE FROM form_templates WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Form not found' });
    res.json({ message: 'Form deleted' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── Photo fields ─────────────────────────────────────────────────────────────
// Uploaded one at a time as a data URL, matching how job attachments already
// work. Falls back to keeping the data URL inline when object storage isn't
// configured, the same degradation fileStore uses elsewhere.
router.post('/photos', async (req, res) => {
  const { filename, data_base64 } = req.body;
  if (!data_base64) return res.status(400).json({ error: 'No image supplied' });
  try {
    const stored = await fileStore.storeDataUrl({ prefix: 'form-photos', filename, dataUrl: data_base64 });
    if (stored) return res.json({ key: stored.key, filename: filename || 'photo', contentType: stored.contentType });
    res.json({ inline: data_base64, filename: filename || 'photo' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Upload failed' }); }
});

// Serving needs the auth header, so the client fetches these as blobs rather
// than pointing an <img src> straight at the URL.
router.get('/photos', async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    const { buffer, contentType } = await fileStore.getObject(key);
    res.set('Content-Type', contentType || 'image/jpeg');
    res.send(buffer);
  } catch (err) { console.error(err); res.status(404).json({ error: 'Not found' }); }
});

module.exports = router;
module.exports.FIELD_TYPES = FIELD_TYPES;
