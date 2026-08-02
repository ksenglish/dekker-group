const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, authenticateAutomation } = require('../middleware/auth');

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
    const { rows } = await pool.query(
      `SELECT id, supplier, invoice_number, detected_job_number, parsed_items,
              mime_type, document_base64, created_at
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
    const { rows: [row] } = await pool.query(
      `INSERT INTO job_cost_scans
         (document_base64, mime_type, supplier, invoice_number, detected_job_number, parsed_items, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'unmatched')
       RETURNING id, supplier, invoice_number, detected_job_number, created_at`,
      [
        document_base64,
        mime_type || 'application/pdf',
        supplier || null,
        invoice_number || null,
        detected_job_number || null,
        JSON.stringify(parsed_items || []),
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

// Delete an inbox scan (not relevant to any job)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM job_cost_scans WHERE id = $1 AND status = 'unmatched'`,
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
