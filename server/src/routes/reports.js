const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const pool = require('../db/pool');

router.use(authenticate);
// subcontractor added explicitly — sales/operations already pass via
// requireRole's office equivalence. Every endpoint below already scopes
// non-admin raw roles to their own jobs/timesheets, so this just grants
// subcontractors that same "my own stuff" view instead of a 403.
router.use(requireRole('admin', 'office', 'subcontractor'));

// Monthly revenue (last 12 months) — filtered to user's jobs for non-admin
router.get('/revenue', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const params = [];
    let userFilter = '';
    if (!isAdmin) {
      userFilter = `AND EXISTS (SELECT 1 FROM job_technicians jt WHERE jt.job_id = i.job_id AND jt.user_id = $1)`;
      params.push(req.user.id);
    }
    const { rows } = await pool.query(`
      SELECT
        DATE_TRUNC('month', i.created_at) AS month,
        COUNT(*) AS invoice_count,
        SUM(i.total) AS total_cents,
        SUM(CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END) AS paid_cents,
        SUM(CASE WHEN i.status != 'paid' AND i.status != 'cancelled' THEN i.total ELSE 0 END) AS outstanding_cents
      FROM invoices i
      WHERE i.created_at >= NOW() - INTERVAL '12 months'
      ${userFilter}
      GROUP BY month
      ORDER BY month ASC
    `, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Job stats by status — filtered to user's jobs for non-admin
router.get('/jobs', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const { from, to } = req.query;
    const conditions = [];
    const params = [];
    let p = 1;
    if (from) { conditions.push(`j.created_at >= $${p}`); params.push(from); p++; }
    if (to)   { conditions.push(`j.created_at <= $${p}`); params.push(to);   p++; }
    if (!isAdmin) {
      conditions.push(`EXISTS (SELECT 1 FROM job_technicians jt WHERE jt.job_id = j.id AND jt.user_id = $${p})`);
      params.push(req.user.id); p++;
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT j.status, COUNT(*) AS count FROM jobs j ${where} GROUP BY j.status ORDER BY count DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Top customers by revenue — admin only
router.get('/customers', async (req, res) => {
  if (req.user.role !== 'admin') return res.json([]);
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

// Tech hours summary — non-admin sees only their own
router.get('/timesheets', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const { from, to } = req.query;
    const params = [];
    let p = 1;
    const conds = [];
    if (from) { conds.push(`t.date >= $${p}`); params.push(from); p++; }
    if (to)   { conds.push(`t.date <= $${p}`); params.push(to);   p++; }
    if (!isAdmin) { conds.push(`t.user_id = $${p}`); params.push(req.user.id); p++; }
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

// Site-visit commission earned per qualifying job, in cents, excl. GST.
// Change this one constant to change the rate.
const SITE_VISIT_COMMISSION_CENTS = 4000; // $40.00

const DEFAULT_STATUSES = [
  { key: 'new', label: 'New' }, { key: 'quoted', label: 'Quoted' },
  { key: 'scheduled', label: 'Scheduled' }, { key: 'in_progress', label: 'In Progress' },
  { key: 'invoiced', label: 'Invoiced' }, { key: 'complete', label: 'Complete' },
  { key: 'cancelled', label: 'Cancelled' },
];

// Which statuses count as "Quoted or above". Derived from the admin-ordered
// status list rather than a fixed list of keys, so it keeps working if the
// pipeline is reordered or the custom stages before Quoted are renamed —
// everything ordered before Quoted (New, Scheduled - Site-Visit, Awaiting
// Quote…) falls out automatically. Cancelled sits outside the pipeline and
// never qualifies.
function qualifyingStatusKeys(statuses) {
  const pipeline = statuses.filter(s => s.key !== 'cancelled');
  const quotedIdx = pipeline.findIndex(s => s.key === 'quoted');
  if (quotedIdx === -1) return [];
  return pipeline.slice(quotedIdx).map(s => s.key);
}

// Jobs that were in one team member's diary over a period, with where each
// job stands now — plus the site-visit commission derived from that same set,
// so the count is always auditable against the list beneath it.
router.get('/user-jobs', async (req, res) => {
  const { from, to } = req.query;
  // Only admins can report on someone else; everyone else sees themselves.
  const userId = req.user.role === 'admin' ? (req.query.user_id || req.user.id) : req.user.id;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
  try {
    const { rows: settingsRows } = await pool.query(`SELECT value FROM settings WHERE key='job_statuses'`);
    const statuses = settingsRows[0]?.value || DEFAULT_STATUSES;
    const qualifying = qualifyingStatusKeys(statuses);

    const { rows } = await pool.query(
      `SELECT j.id, j.job_number, j.external_ref, j.status, j.type,
              c.name AS customer_name,
              COALESCE(cs.address, j.site_address) AS site_address,
              MIN(s.scheduled_date) AS first_scheduled,
              COUNT(s.id) AS appointment_count
       FROM schedules s
       JOIN jobs j ON j.id = s.job_id
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN customer_sites cs ON cs.id = j.site_id
       WHERE s.user_id = $1 AND s.scheduled_date >= $2 AND s.scheduled_date <= $3
       GROUP BY j.id, j.job_number, j.external_ref, j.status, j.type, c.name, cs.address, j.site_address
       ORDER BY MIN(s.scheduled_date) DESC`,
      [userId, from, to]
    );

    const jobs = rows.map(j => ({ ...j, counts_toward_commission: qualifying.includes(j.status) }));
    const qualifyingCount = jobs.filter(j => j.counts_toward_commission).length;

    res.json({
      user_id: userId,
      jobs,
      statuses,
      qualifying_statuses: qualifying,
      commission: {
        qualifying_jobs: qualifyingCount,
        rate_cents: SITE_VISIT_COMMISSION_CENTS,
        amount_cents: qualifyingCount * SITE_VISIT_COMMISSION_CENTS,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Recent activity log — admin only
router.get('/activity', async (req, res) => {
  if (req.user.role !== 'admin') return res.json([]);
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
