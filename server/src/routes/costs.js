const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { extractLineItems } = require('../services/invoiceExtract');

router.use(authenticate);

// Line items are stored two different ways depending on how the scan arrived:
// a job-linked scan has real job_costs rows, an unlinked one only has whatever
// Claude parsed off the PDF. Both are summed to a single total so the two
// folders read the same way.
const TOTAL_FROM_JOB_COSTS = `
  COALESCE((
    SELECT SUM(c.quantity * c.unit_price) FROM job_costs c WHERE c.scan_id = s.id
  ), 0)`;

// ── Folders ──────────────────────────────────────────────────────────────────

// Flat list with parent_id — the client nests it. Counts are per folder rather
// than rolled up through the subtree, so a number next to a folder always means
// "filed directly in here".
router.get('/folders', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*,
              (SELECT COUNT(*)::int FROM job_cost_scans s WHERE s.folder_id = f.id) AS document_count,
              (SELECT COUNT(*)::int FROM cost_folders c WHERE c.parent_id = f.id) AS child_count
       FROM cost_folders f
       ORDER BY f.name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/folders', requireRole('admin'), async (req, res) => {
  const { name, parent_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Folder name is required' });
  try {
    if (parent_id) {
      const { rows: [parent] } = await pool.query('SELECT id FROM cost_folders WHERE id = $1', [parent_id]);
      if (!parent) return res.status(404).json({ error: 'That parent folder no longer exists' });
    }
    const { rows } = await pool.query(
      'INSERT INTO cost_folders (name, parent_id, created_by) VALUES ($1,$2,$3) RETURNING *',
      [name.trim(), parent_id || null, req.user.id]
    );
    res.status(201).json({ ...rows[0], document_count: 0, child_count: 0 });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: parent_id
          ? 'That folder already has a subfolder with this name'
          : 'A folder with that name already exists',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/folders/:id', requireRole('admin'), async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Folder name is required' });
  try {
    const { rowCount } = await pool.query(
      'UPDATE cost_folders SET name = $1 WHERE id = $2', [name.trim(), req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Folder not found' });
    res.json({ message: 'Renamed' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A folder with that name already exists' });
    res.status(500).json({ error: err.message });
  }
});

// Refuses while the folder still holds anything — documents or subfolders —
// rather than quietly cutting a subtree loose where nobody would find it again.
router.delete('/folders/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rows: [count] } = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM job_cost_scans WHERE folder_id = $1) AS docs,
              (SELECT COUNT(*)::int FROM cost_folders WHERE parent_id = $1) AS kids`,
      [req.params.id]
    );
    if (count.docs > 0 || count.kids > 0) {
      const parts = [];
      if (count.docs) parts.push(`${count.docs} document${count.docs === 1 ? '' : 's'}`);
      if (count.kids) parts.push(`${count.kids} subfolder${count.kids === 1 ? '' : 's'}`);
      return res.status(409).json({
        error: `This folder still holds ${parts.join(' and ')}. Empty it first.`,
      });
    }
    const { rowCount } = await pool.query('DELETE FROM cost_folders WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Folder not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Direct costs — supplier invoices attached to a job ───────────────────────

router.get('/direct', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.supplier, s.invoice_number, s.mime_type, s.created_at, s.job_id,
              j.job_number, j.external_ref, j.description AS job_description,
              c.name AS customer_name,
              ${TOTAL_FROM_JOB_COSTS} AS total_cents,
              (SELECT COUNT(*)::int FROM job_costs jc WHERE jc.scan_id = s.id) AS item_count
       FROM job_cost_scans s
       JOIN jobs j ON j.id = s.job_id
       LEFT JOIN customers c ON c.id = j.customer_id
       WHERE s.job_id IS NOT NULL AND s.document_base64 IS NOT NULL
       ORDER BY s.created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Operating costs — filed by supplier folder ───────────────────────────────

router.get('/operating', async (req, res) => {
  const { folder_id } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.supplier, s.invoice_number, s.mime_type, s.created_at,
              s.folder_id, s.parsed_items, f.name AS folder_name
       FROM job_cost_scans s
       LEFT JOIN cost_folders f ON f.id = s.folder_id
       WHERE s.status = 'filed'
         AND ($1::uuid IS NULL OR s.folder_id = $1::uuid)
       ORDER BY s.created_at DESC`,
      [folder_id || null]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload a PDF or a photo of a receipt straight into a folder. The scanner
// reads the line items off it so a hand-filed document carries the same detail
// as one that arrived through the mailbox. A scan that finds nothing still
// files — the document is the point, the items are a bonus.
router.post('/documents', requireRole('admin', 'office'), async (req, res) => {
  const { folder_id, mime_type, data_base64 } = req.body;
  if (!folder_id) return res.status(400).json({ error: 'Choose a folder to file this in' });
  if (!data_base64 || !mime_type) return res.status(400).json({ error: 'File data required' });

  try {
    const { rows: [folder] } = await pool.query('SELECT id FROM cost_folders WHERE id = $1', [folder_id]);
    if (!folder) return res.status(404).json({ error: 'That folder no longer exists' });

    let scan = { items: [], gst_treatment: 'exclusive', supplier: null, invoice_number: null };
    let scan_error = null;
    try {
      scan = await extractLineItems({ base64: data_base64, mimeType: mime_type });
    } catch (err) {
      scan_error = err.message || 'Could not read the line items off this document';
    }

    const { rows } = await pool.query(
      `INSERT INTO job_cost_scans
         (folder_id, status, document_base64, mime_type, supplier, invoice_number,
          gst_treatment, parsed_items)
       VALUES ($1, 'filed', $2, $3, $4, $5, $6, $7)
       RETURNING id, supplier, invoice_number, mime_type, created_at, folder_id, parsed_items`,
      [
        folder_id, data_base64, mime_type,
        req.body.supplier?.trim() || scan.supplier,
        req.body.invoice_number?.trim() || scan.invoice_number,
        scan.gst_treatment, JSON.stringify(scan.items),
      ]
    );
    res.status(201).json({ ...rows[0], scan_error });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Serves the stored PDF. Job-linked scans already have a route under /jobs, but
// a filed operating cost has no job to hang off, so it needs its own.
router.get('/documents/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT document_base64, mime_type FROM job_cost_scans WHERE id = $1', [req.params.id]
    );
    if (!rows[0]?.document_base64) return res.status(404).json({ error: 'Not found' });
    const buf = Buffer.from(rows[0].document_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    res.set('Content-Type', rows[0].mime_type || 'application/pdf');
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Move a filed document to a different folder, or delete it outright.
router.put('/documents/:id/folder', requireRole('admin', 'office'), async (req, res) => {
  const { folder_id } = req.body;
  if (!folder_id) return res.status(400).json({ error: 'folder_id required' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE job_cost_scans SET folder_id = $1 WHERE id = $2 AND status = 'filed'`,
      [folder_id, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ message: 'Moved' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/documents/:id', requireRole('admin', 'office'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM job_cost_scans WHERE id = $1 AND status = 'filed'`, [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
