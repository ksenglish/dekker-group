const express = require('express');
const router = express.Router();
const c = require('../controllers/jobController');
const { importTradify } = require('../controllers/importController');
const { authenticate, requireRole, authenticateAutomation } = require('../middleware/auth');

// Automation endpoint — accepts X-API-Key or user JWT
router.get('/by-number/:number', authenticateAutomation, async (req, res) => {
  try {
    const pool = require('../db/pool');
    // Strip optional "JB" prefix and leading zeros to get the integer
    const num = parseInt(req.params.number.replace(/^[A-Za-z]+0*/,''), 10);
    if (isNaN(num)) return res.status(400).json({ error: 'Invalid job number' });
    const { rows } = await pool.query(
      `SELECT j.id, j.job_number, j.title, j.status,
              c.name AS customer_name
       FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id
       WHERE j.job_number = $1`,
      [num]
    );
    if (!rows[0]) return res.status(404).json({ error: `No job found with number ${req.params.number}` });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.use(authenticate);

// Geocode an address using Nominatim (OpenStreetMap) — free, no API key required
router.post('/geocode', requireRole('admin', 'office'), async (req, res) => {
  const { address, site_id } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const pool = require('../db/pool');
    const https = require('https');
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=nz`;
    const data = await new Promise((resolve, reject) => {
      https.get(url, {
        headers: { 'User-Agent': 'DekkerGroupApp/1.0 (kyle@dekkergroup.co.nz)' }
      }, r => {
        let body = '';
        r.on('data', d => body += d);
        r.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });
    if (!data[0]) return res.status(404).json({ error: 'Address not found' });
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (site_id) {
      await pool.query('UPDATE customer_sites SET lat=$1, lng=$2 WHERE id=$3', [lat, lng, site_id]);
    }
    res.json({ lat, lng, formatted: data[0].display_name });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Geocode failed' }); }
});

// Bulk import jobs from a Tradify CSV export (admin only)
router.post('/import/tradify', requireRole('admin'), importTradify);

router.get('/', c.list);
router.post('/', requireRole('admin', 'office'), c.create);
router.get('/:id', c.get);
router.put('/:id', requireRole('admin', 'office'), c.update);
router.patch('/:id/status', requireRole('admin', 'office'), c.updateStatus);
router.delete('/:id', requireRole('admin'), c.remove);

// Line items
router.put('/:id/line-items', requireRole('admin', 'office'), c.updateLineItems);

// Notes
router.get('/:id/notes', c.listNotes);
router.post('/:id/notes', c.createNote);
router.delete('/:id/notes/:noteId', requireRole('admin', 'office'), c.deleteNote);

// Email customer from job
router.post('/:id/email', requireRole('admin', 'office'), async (req, res) => {
  try {
    const pool = require('../db/pool');
    const { sendMail } = require('../utils/email');
    const { logActivity } = require('../utils/activity');
    const { subject, body } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject and body are required' });
    const { rows: [job] } = await pool.query(
      `SELECT j.*, c.email AS customer_email, c.name AS customer_name
       FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id WHERE j.id=$1`,
      [req.params.id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.customer_email) return res.status(400).json({ error: 'Customer has no email address' });
    await sendMail({ to: job.customer_email, subject, html: body.replace(/\n/g, '<br>'), text: body });
    await pool.query(
      `INSERT INTO email_log (customer_id, job_id, type, recipient) VALUES ($1,$2,'job_email',$3)`,
      [job.customer_id, job.id, job.customer_email]
    );
    await logActivity({ type: 'email_sent', entity_type: 'job', entity_id: job.id, user_id: req.user.id,
      message: `Email sent to ${job.customer_name} re Job #${job.job_number}` });
    res.json({ message: 'Email sent' });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to send email' }); }
});

// Attachments (photos from site)
const pool = require('../db/pool');
router.get('/:id/attachments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.filename, a.mime_type, a.created_at, u.name AS uploader_name
       FROM job_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.job_id=$1 ORDER BY a.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.get('/:id/attachments/:attId/data', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM job_attachments WHERE id=$1 AND job_id=$2', [req.params.attId, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const buf = Buffer.from(rows[0].data_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    res.set('Content-Type', rows[0].mime_type || 'image/jpeg');
    res.set('Content-Disposition', `inline; filename="${rows[0].filename}"`);
    res.send(buf);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/:id/attachments', async (req, res) => {
  const { filename, mime_type, data_base64 } = req.body;
  if (!data_base64 || !filename) return res.status(400).json({ error: 'filename and data_base64 required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO job_attachments (job_id, uploaded_by, filename, mime_type, data_base64)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, mime_type, created_at`,
      [req.params.id, req.user.id, filename, mime_type || 'image/jpeg', data_base64]
    );
    res.status(201).json(rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.delete('/:id/attachments/:attId', async (req, res) => {
  try {
    await pool.query('DELETE FROM job_attachments WHERE id=$1 AND job_id=$2', [req.params.attId, req.params.id]);
    res.json({ message: 'Deleted' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Job Costs ─────────────────────────────────────────────────────────────────

router.get('/:id/costs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, s.gst_treatment, s.created_at AS scan_date
       FROM job_costs c
       LEFT JOIN job_cost_scans s ON s.id = c.scan_id
       WHERE c.job_id=$1 ORDER BY c.created_at, c.sort_order`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/costs', authenticateAutomation, async (req, res) => {
  const { items, document_base64, mime_type, gst_treatment } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });
  try {
    let scanId = null;
    if (document_base64) {
      const { rows: [scan] } = await pool.query(
        `INSERT INTO job_cost_scans (job_id, document_base64, mime_type, gst_treatment)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [req.params.id, document_base64, mime_type || 'image/jpeg', gst_treatment || 'exclusive']
      );
      scanId = scan.id;
    }
    const inserted = [];
    for (let i = 0; i < items.length; i++) {
      const { description, quantity, unit_price } = items[i];
      const { rows: [row] } = await pool.query(
        `INSERT INTO job_costs (job_id, scan_id, description, quantity, unit_price, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.params.id, scanId, description, quantity || 1, Math.round((unit_price || 0) * 100), i]
      );
      inserted.push(row);
    }
    res.status(201).json({ items: inserted, scan_id: scanId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/costs/:costId', async (req, res) => {
  try {
    await pool.query('DELETE FROM job_costs WHERE id=$1 AND job_id=$2', [req.params.costId, req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/cost-scans', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, job_id, mime_type, gst_treatment, created_at FROM job_cost_scans WHERE job_id=$1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/cost-scans/:scanId/document', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT document_base64, mime_type FROM job_cost_scans WHERE id=$1 AND job_id=$2',
      [req.params.scanId, req.params.id]
    );
    if (!rows[0] || !rows[0].document_base64) return res.status(404).json({ error: 'Not found' });
    const buf = Buffer.from(rows[0].document_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    res.set('Content-Type', rows[0].mime_type || 'image/jpeg');
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
