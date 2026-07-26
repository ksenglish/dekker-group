const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole, normaliseRole } = require('../middleware/auth');

router.use(authenticate);

const isAdmin = req => normaliseRole(req.user.role) === 'admin';

// ── Documents ────────────────────────────────────────────────────────────────
// Every signed-in staff member can read the folders; only admins change them.

router.get('/folders', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, COUNT(d.id)::int AS document_count
       FROM hub_folders f
       LEFT JOIN hub_documents d ON d.folder_id = f.id
       GROUP BY f.id ORDER BY f.sort_order, f.name`
    );
    res.json(rows);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

// Deliberately omits data_base64 — the payloads are large and the list only
// needs metadata. Content comes from the download route.
router.get('/folders/:id/documents', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.folder_id, d.filename, d.mime_type, d.size_bytes, d.created_at,
              u.name AS uploaded_by_name
       FROM hub_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.folder_id = $1 ORDER BY d.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.post('/folders/:id/documents', requireRole('admin'), async (req, res) => {
  const { filename, mime_type, data_base64 } = req.body || {};
  if (!filename || !data_base64) return res.status(400).json({ error: 'filename and data_base64 are required' });
  if (mime_type && mime_type !== 'application/pdf') {
    return res.status(400).json({ error: 'Only PDF documents can be uploaded' });
  }
  try {
    const { rows: [folder] } = await pool.query('SELECT id FROM hub_folders WHERE id=$1', [req.params.id]);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    // Rough decoded size from the base64 payload, for display only.
    const b64 = data_base64.replace(/^data:[^;]+;base64,/, '');
    const sizeBytes = Math.round((b64.length * 3) / 4);
    const { rows } = await pool.query(
      `INSERT INTO hub_documents (folder_id, filename, mime_type, size_bytes, data_base64, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, folder_id, filename, mime_type, size_bytes, created_at`,
      [req.params.id, filename, mime_type || 'application/pdf', sizeBytes, data_base64, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.get('/documents/:id/data', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM hub_documents WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const doc = rows[0];
    const buf = Buffer.from(doc.data_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    res.set({
      'Content-Type': doc.mime_type || 'application/pdf',
      'Content-Disposition': `inline; filename="${doc.filename.replace(/"/g, '')}"`,
    });
    res.send(buf);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/documents/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM hub_documents WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

// ── Company events ───────────────────────────────────────────────────────────

router.get('/events', async (req, res) => {
  // Upcoming by default; ?past=1 for the archive.
  const past = req.query.past === '1';
  try {
    const { rows } = await pool.query(
      `SELECT e.*, u.name AS created_by_name
       FROM hub_events e LEFT JOIN users u ON u.id = e.created_by
       WHERE e.event_date ${past ? '<' : '>='} CURRENT_DATE
       ORDER BY e.event_date ${past ? 'DESC' : 'ASC'}, e.start_time NULLS LAST`
    );
    res.json(rows);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.post('/events', requireRole('admin'), async (req, res) => {
  const { title, description, event_date, start_time, location } = req.body || {};
  if (!title?.trim() || !event_date) return res.status(400).json({ error: 'Title and date are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO hub_events (title, description, event_date, start_time, location, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title.trim(), description || null, event_date, start_time || null, location || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.put('/events/:id', requireRole('admin'), async (req, res) => {
  const { title, description, event_date, start_time, location } = req.body || {};
  if (!title?.trim() || !event_date) return res.status(400).json({ error: 'Title and date are required' });
  try {
    const { rows } = await pool.query(
      `UPDATE hub_events SET title=$1, description=$2, event_date=$3, start_time=$4, location=$5
       WHERE id=$6 RETURNING *`,
      [title.trim(), description || null, event_date, start_time || null, location || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/events/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM hub_events WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

// ── App feedback ─────────────────────────────────────────────────────────────

router.get('/feedback', async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status === 'resolved' || status === 'unresolved') {
    params.push(status);
    where = 'WHERE f.status = $1';
  }
  try {
    const { rows } = await pool.query(
      `SELECT f.*, u.name AS created_by_name, r.name AS resolved_by_name
       FROM hub_feedback f
       LEFT JOIN users u ON u.id = f.created_by
       LEFT JOIN users r ON r.id = f.resolved_by
       ${where}
       ORDER BY f.status = 'resolved', f.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.post('/feedback', async (req, res) => {
  const { message } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'Feedback message is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO hub_feedback (message, created_by) VALUES ($1,$2) RETURNING *`,
      [message.trim(), req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.patch('/feedback/:id/status', requireRole('admin'), async (req, res) => {
  const { status } = req.body || {};
  if (!['resolved', 'unresolved'].includes(status)) {
    return res.status(400).json({ error: 'Status must be resolved or unresolved' });
  }
  // The resolving flag is passed as its own boolean parameter — reusing $1
  // both as the stored status and inside the CASE tests leaves Postgres
  // unable to deduce a single type for it.
  const resolving = status === 'resolved';
  try {
    const { rows } = await pool.query(
      `UPDATE hub_feedback
       SET status=$1,
           resolved_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
           resolved_by = CASE WHEN $2::boolean THEN $3::uuid ELSE NULL END
       WHERE id=$4 RETURNING *`,
      [status, resolving, req.user.id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

// Authors can withdraw their own feedback; admins can remove any.
router.delete('/feedback/:id', async (req, res) => {
  try {
    const { rows: [fb] } = await pool.query('SELECT created_by FROM hub_feedback WHERE id=$1', [req.params.id]);
    if (!fb) return res.status(404).json({ error: 'Not found' });
    if (!isAdmin(req) && fb.created_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete feedback you submitted' });
    }
    await pool.query('DELETE FROM hub_feedback WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
