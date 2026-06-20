const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const pool = require('../db/pool');

router.use(authenticate);
router.use(requireRole('admin', 'office'));

// Monthly revenue (last 12 months)
router.get('/revenue', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        DATE_TRUNC('month', created_at) AS month,
        COUNT(*) AS invoice_count,
        SUM(total) AS total_cents,
        SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) AS paid_cents,
        SUM(CASE WHEN status != 'paid' AND status != 'cancelled' THEN total ELSE 0 END) AS outstanding_cents
      FROM invoices
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY month
      ORDER BY month ASC
    `);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Job stats by status
router.get('/jobs', async (req, res) => {
  try {
    const { from, to } = req.query;
    const conditions = [];
    const params = [];
    let p = 1;
    if (from) { conditions.push(`created_at >= $${p}`); params.push(from); p++; }
    if (to) { conditions.push(`created_at <= $${p}`); params.push(to); p++; }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT status, COUNT(*) AS count FROM jobs ${where} GROUP BY status ORDER BY count DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Top customers by revenue
router.get('/customers', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.company,
             COUNT(DISTINCT i.id) AS invoice_count,
             SUM(i.total) AS total_cents,
             SUM(CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END) AS paid_cents
      FROM customers c
      JOIN invoices i ON i.customer_id = c.id
      GROUP BY c.id, c.name, c.company
      ORDER BY total_cents DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Tech hours summary (for pay period)
router.get('/timesheets', async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let p = 1;
    const conds = [];
    if (from) { conds.push(`t.date >= $${p}`); params.push(from); p++; }
    if (to) { conds.push(`t.date <= $${p}`); params.push(to); p++; }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT u.id, u.name, SUM(t.hours) AS total_hours, COUNT(DISTINCT t.job_id) AS job_count
       FROM timesheets t JOIN users u ON u.id = t.user_id
       ${where}
       GROUP BY u.id, u.name ORDER BY total_hours DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Recent activity log
router.get('/activity', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, u.name AS user_name FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT 20`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
