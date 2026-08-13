const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, authenticateAutomation } = require('../middleware/auth');
const fileStore = require('../services/fileStore');

// Count unmatched (for sidebar badge)
router.get('/count', authenticate, async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM job_cost_scans WHERE status = 'unmatched'`
    );
    res.json({ count: row.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List all unmatched scans
router.get('/', authenticate, async (req, res) => {
  try {
    // Deliberately not the document itself. This list sent every unmatched
    // PDF down with it, so opening PDF Check with a few dozen waiting meant
    // downloading all of them to show a list of suppliers and totals. The
    // client asks for one when someone actually clicks View PDF.
    const { rows } = await pool.query(
      `SELECT id, supplier, invoice_number, detected_job_number, parsed_items,
              mime_type, created_at,
              (document_base64 IS NOT NULL OR storage_key IS NOT NULL) AS has_document
       FROM job_cost_scans
       WHERE status = 'unmatched'
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Automation: save an unmatched invoice to the inbox
router.post('/', authenticateAutomation, async (req, res) => {
  const { document_base64, mime_type, supplier, invoice_number, detected_job_number, parsed_items } = req.body;
  try {
    // Arrives from the Apps Script as a data URL; the bucket takes it from here.
    const stored = await fileStore.storeDataUrl({
      prefix: 'cost-scans/inbox',
      filename: `${invoice_number || 'invoice'}.pdf`,
      dataUrl: document_base64,
    });

    const { rows: [row] } = await pool.query(
      `INSERT INTO job_cost_scans
         (document_base64, mime_type, supplier, invoice_number, detected_job_number, parsed_items, status,
          storage_key, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, 'unmatched', $7, $8)
       RETURNING id, supplier, invoice_number, detected_job_number, created_at`,
      [
        stored ? null : document_base64,
        mime_type || 'application/pdf',
        supplier || null,
        invoice_number || null,
        detected_job_number || null,
        JSON.stringify(parsed_items || []),
        stored?.key || null, stored?.size || null,
      ]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error('Invoice inbox save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Link an inbox scan to a job and post its cost items
router.post('/:id/link', authenticate, async (req, res) => {
  const { job_id, items, gst_treatment } = req.body;
  if (!job_id) return res.status(400).json({ error: 'job_id required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch the scan and update it to matched
    const { rows: [scan] } = await client.query(
      `UPDATE job_cost_scans
       SET job_id = $1, status = 'matched', gst_treatment = $2
       WHERE id = $3 AND status = 'unmatched'
       RETURNING *`,
      [job_id, gst_treatment || 'exclusive', req.params.id]
    );
    if (!scan) return res.status(404).json({ error: 'Inbox item not found' });

    // Use items from request, falling back to what Claude parsed originally
    const costItems = (items && items.length > 0) ? items : (scan.parsed_items || []);
    for (let i = 0; i < costItems.length; i++) {
      const { description, quantity, unit_price } = costItems[i];
      await client.query(
        `INSERT INTO job_costs (job_id, scan_id, description, quantity, unit_price, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [job_id, scan.id, description, quantity || 1, Math.round((unit_price || 0) * 100), i]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Linked successfully', items_posted: costItems.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// File an unmatched scan into an operating-cost folder. It leaves PDF Check
// and shows up under Reports → Costs → Operating Costs, keeping the line items
// Claude parsed so the document isn't just a PDF with no figures behind it.
router.post('/:id/file', authenticate, async (req, res) => {
  const { folder_id } = req.body;
  if (!folder_id) return res.status(400).json({ error: 'folder_id required' });
  try {
    const { rows: [folder] } = await pool.query('SELECT id FROM cost_folders WHERE id = $1', [folder_id]);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const { rows } = await pool.query(
      `UPDATE job_cost_scans
       SET folder_id = $1, status = 'filed'
       WHERE id = $2 AND status = 'unmatched'
       RETURNING id, supplier, invoice_number, folder_id`,
      [folder_id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Inbox item not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk delete — declared before /:id so "bulk-delete" isn't read as an id
router.post('/bulk-delete', authenticate, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
  try {
    const { rows, rowCount } = await pool.query(
      `DELETE FROM job_cost_scans WHERE id = ANY($1::uuid[]) AND status = 'unmatched' RETURNING storage_key`,
      [ids]
    );
    for (const row of rows) {
      if (row.storage_key) await fileStore.deleteObject(row.storage_key);
    }
    res.json({ message: `Deleted ${rowCount} invoice${rowCount === 1 ? '' : 's'}`, deleted: rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete an inbox scan (not relevant to any job)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rows, rowCount } = await pool.query(
      `DELETE FROM job_cost_scans WHERE id = $1 AND status = 'unmatched' RETURNING storage_key`,
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    if (rows[0].storage_key) await fileStore.deleteObject(rows[0].storage_key);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
