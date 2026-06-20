const express = require('express');
const router = express.Router();
const c = require('../controllers/invoiceController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);
router.use(requireRole('admin', 'office'));

router.get('/', c.list);
router.get('/:id', c.get);
router.put('/:id', c.update);
router.post('/:id/paid', c.markPaid);
router.get('/:id/pdf', c.downloadPdf);
router.post('/:id/email', c.sendEmail);

// Payments
const pool = require('../db/pool');
router.get('/:id/payments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.name AS recorded_by_name FROM invoice_payments p
       LEFT JOIN users u ON u.id = p.recorded_by
       WHERE p.invoice_id=$1 ORDER BY p.paid_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/:id/payments', async (req, res) => {
  const { amount, method, reference, paid_at } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount is required' });
  try {
    const { rows: [inv] } = await pool.query('SELECT * FROM invoices WHERE id=$1', [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const { rows: [payment] } = await pool.query(
      `INSERT INTO invoice_payments (invoice_id, amount, method, reference, paid_at, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, Math.round(amount * 100), method || 'bank_transfer', reference || null,
       paid_at || new Date().toISOString().split('T')[0], req.user.id]
    );
    // Check if fully paid
    const { rows: [totals] } = await pool.query(
      'SELECT SUM(amount) AS paid FROM invoice_payments WHERE invoice_id=$1', [req.params.id]
    );
    if (parseInt(totals.paid) >= inv.total) {
      await pool.query(`UPDATE invoices SET status='paid', paid_at=NOW(), updated_at=NOW() WHERE id=$1`, [req.params.id]);
      await pool.query(`UPDATE jobs SET status='complete', updated_at=NOW() WHERE id=$1`, [inv.job_id]);
    }
    res.status(201).json(payment);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});
router.delete('/:id/payments/:payId', async (req, res) => {
  try {
    await pool.query('DELETE FROM invoice_payments WHERE id=$1 AND invoice_id=$2', [req.params.payId, req.params.id]);
    res.json({ message: 'Deleted' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
