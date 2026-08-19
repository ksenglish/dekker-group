const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const pool = require('../db/pool');
const { buildPDF } = require('../utils/pdf');
const { sendMail } = require('../utils/email');
const { getTheme } = require('../controllers/settingsController');

router.use(authenticate);
// subcontractor added explicitly — sales/operations already pass via
// requireRole's office equivalence. Every endpoint below already scopes
// non-admin raw roles to their own jobs/timesheets, so this just grants
// subcontractors that same "my own stuff" view instead of a 403.
router.use(requireRole('admin', 'office', 'subcontractor'));

// Monthly revenue (last 12 months) — filtered to user's jobs for non-admin
// ── Marketing: what each lead source produced against what it cost ──────────
//
// Attribution runs through the customer: a customer carries the lead_source
// that brought them in, and their jobs and invoices inherit it. That means a
// customer who came from one source and later returns still counts to that
// source, which is the honest reading of "where did this work come from".
//
// Revenue counts invoices that are actually money — draft invoices are excluded
// since they have not been sent to anyone. Costs are unfiltered by the date
// range on purpose: spend is usually recorded monthly while jobs land later,
// and clipping it would flatter recent sources.
router.get('/marketing', requireRole('admin'), async (req, res) => {
  const { from, to } = req.query;
  try {
    const { rows } = await pool.query(
      `WITH sourced AS (
         SELECT COALESCE(NULLIF(TRIM(c.lead_source), ''), 'Not recorded') AS source, c.id
         FROM customers c
       ),
       job_counts AS (
         SELECT s.source, COUNT(j.id)::int AS job_count
         FROM sourced s JOIN jobs j ON j.customer_id = s.id
         WHERE ($1::date IS NULL OR j.created_at::date >= $1::date)
           AND ($2::date IS NULL OR j.created_at::date <= $2::date)
         GROUP BY s.source
       ),
       revenue AS (
         -- Older invoices can carry the customer only through their job, so
         -- fall back to that rather than dropping them from the report.
         SELECT s.source,
                COALESCE(SUM(i.total), 0)::bigint AS revenue_cents,
                COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END), 0)::bigint AS paid_cents,
                COUNT(i.id)::int AS invoice_count
         FROM invoices i
         LEFT JOIN jobs j ON j.id = i.job_id
         JOIN sourced s ON s.id = COALESCE(i.customer_id, j.customer_id)
         WHERE i.status <> 'draft'
           AND ($1::date IS NULL OR i.created_at::date >= $1::date)
           AND ($2::date IS NULL OR i.created_at::date <= $2::date)
         GROUP BY s.source
       ),
       costs AS (
         SELECT COALESCE(NULLIF(TRIM(source), ''), 'Not recorded') AS source,
                COALESCE(SUM(amount_cents), 0)::bigint AS cost_cents
         FROM marketing_costs GROUP BY 1
       ),
       all_sources AS (
         SELECT source FROM job_counts
         UNION SELECT source FROM revenue
         UNION SELECT source FROM costs
       )
       SELECT a.source,
              COALESCE(jc.job_count, 0)      AS job_count,
              COALESCE(r.revenue_cents, 0)   AS revenue_cents,
              COALESCE(r.paid_cents, 0)      AS paid_cents,
              COALESCE(r.invoice_count, 0)   AS invoice_count,
              COALESCE(co.cost_cents, 0)     AS cost_cents
       FROM all_sources a
       LEFT JOIN job_counts jc ON jc.source = a.source
       LEFT JOIN revenue r     ON r.source  = a.source
       LEFT JOIN costs co      ON co.source = a.source
       ORDER BY COALESCE(r.revenue_cents, 0) DESC, a.source`,
      [from || null, to || null]
    );
    res.json(rows);
  } catch (err) {
    console.error('Marketing report failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/marketing/costs', requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, u.name AS created_by_name
       FROM marketing_costs m LEFT JOIN users u ON u.id = m.created_by
       ORDER BY m.incurred_on DESC, m.created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/marketing/costs', requireRole('admin'), async (req, res) => {
  const { source, amount, incurred_on, notes } = req.body;
  if (!source?.trim()) return res.status(400).json({ error: 'A lead source is required' });
  const amountCents = Math.round(parseFloat(amount) * 100);
  if (!Number.isFinite(amountCents)) return res.status(400).json({ error: 'Enter an amount' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO marketing_costs (source, amount_cents, incurred_on, notes, created_by)
       VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5) RETURNING *`,
      [source.trim(), amountCents, incurred_on || null, notes?.trim() || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/marketing/costs/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM marketing_costs WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

// Single source of truth for the diary report and the commission invoice, so
// the PDF can never disagree with the figures shown on screen.
async function commissionData(userId, from, to) {
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
  const qualifyingJobs = jobs.filter(j => j.counts_toward_commission);
  const amount = qualifyingJobs.length * SITE_VISIT_COMMISSION_CENTS;

  return {
    jobs, qualifyingJobs, statuses, qualifying,
    commission: {
      qualifying_jobs: qualifyingJobs.length,
      rate_cents: SITE_VISIT_COMMISSION_CENTS,
      amount_cents: amount,
    },
  };
}

// GST is only charged when the supplier is registered for it.
function commissionTotals(amountCents, gstRegistered) {
  const gst = gstRegistered ? Math.round(amountCents * 0.15) : 0;
  return { subtotal: amountCents, gst, total: amountCents + gst };
}

function jobRef(j) {
  return j.external_ref || (j.job_number ? `JB${String(j.job_number).padStart(5, '0')}` : j.id.slice(0, 8).toUpperCase());
}

function fmtDay(d) {
  return d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

// Only admins can report on someone else; everyone else is pinned to themselves.
function targetUserId(req) {
  return req.user.role === 'admin' ? (req.query.user_id || req.body?.user_id || req.user.id) : req.user.id;
}

// Jobs that were in one team member's diary over a period, with where each
// job stands now — plus the site-visit commission derived from that same set,
// so the count is always auditable against the list beneath it.
router.get('/user-jobs', async (req, res) => {
  const { from, to } = req.query;
  const userId = targetUserId(req);
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
  try {
    const data = await commissionData(userId, from, to);
    res.json({
      user_id: userId,
      jobs: data.jobs,
      statuses: data.statuses,
      qualifying_statuses: data.qualifying,
      commission: data.commission,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Build the Buyer Created Invoice for one team member's commission over a
// period. Dekker is the buyer raising the invoice on the supplier's behalf.
async function buildCommissionBCI(userId, from, to) {
  const { rows: [supplier] } = await pool.query(
    'SELECT id, name, email, address, gst_number, gst_registered FROM users WHERE id=$1', [userId]
  );
  if (!supplier) return { error: 'Team member not found' };

  const data = await commissionData(userId, from, to);
  if (data.qualifyingJobs.length === 0) {
    return { error: 'No commission-earning jobs in this period — nothing to invoice.' };
  }

  const { subtotal, gst, total } = commissionTotals(data.commission.amount_cents, supplier.gst_registered);
  const theme = await getTheme();

  const items = data.qualifyingJobs.map(j => ({
    description: `${jobRef(j)} — ${j.customer_name || 'No customer'}${j.site_address ? `, ${j.site_address}` : ''}`
      + `${j.first_scheduled ? ` (${fmtDay(j.first_scheduled)})` : ''}`,
    quantity: 1,
    unit_price: SITE_VISIT_COMMISSION_CENTS,
  }));

  const periodStr = `${fmtDay(from)} to ${fmtDay(to)}`;
  const pdf = await buildPDF({
    type: 'Buyer Created Invoice',
    number: `BCI-${String(supplier.name || '').split(' ')[0].toUpperCase()}-${String(from).replace(/-/g, '')}`,
    partyLabel: 'SUPPLIER',
    customer: {
      name: supplier.name,
      email: supplier.email,
      address: supplier.address,
      gstNumber: supplier.gst_registered ? supplier.gst_number : null,
    },
    items, subtotal, gst, total,
    status: 'issued',
    issuedAt: new Date(),
    notes: `Site-visit commission for ${periodStr}.\n`
      + `${data.qualifyingJobs.length} job${data.qualifyingJobs.length === 1 ? '' : 's'} at `
      + `$${(SITE_VISIT_COMMISSION_CENTS / 100).toFixed(2)} each (excl. GST).\n`
      + (supplier.gst_registered
        ? 'This is a buyer created invoice. GST has been included as the supplier is GST registered.'
        : 'This is a buyer created invoice. No GST has been charged as the supplier is not GST registered.'),
    theme,
  });

  return { pdf, supplier, subtotal, gst, total, periodStr, jobCount: data.qualifyingJobs.length, theme };
}

// Preview — returns the PDF inline so the browser can display it
router.get('/commission-bci', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
  try {
    const built = await buildCommissionBCI(targetUserId(req), from, to);
    if (built.error) return res.status(400).json({ error: built.error });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="commission-${built.supplier.name.replace(/\s+/g, '-').toLowerCase()}-${from}.pdf"`,
    });
    res.send(built.pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

// Send — emails the same PDF to the team member it belongs to
router.post('/commission-bci/send', async (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
  try {
    const built = await buildCommissionBCI(targetUserId(req), from, to);
    if (built.error) return res.status(400).json({ error: built.error });
    const { supplier, pdf, total, periodStr, jobCount, theme } = built;
    if (!supplier.email) return res.status(400).json({ error: `${supplier.name} has no email address on file.` });

    const totalStr = `$${(total / 100).toFixed(2)}`;
    await sendMail({
      to: supplier.email,
      subject: `Buyer Created Invoice — site-visit commission ${periodStr}`,
      html: `<p>Hi ${String(supplier.name || '').split(' ')[0]},</p>
<p>Please find attached your buyer created invoice for site-visit commission covering ${periodStr}.</p>
<p><strong>${jobCount} job${jobCount === 1 ? '' : 's'} · ${totalStr}${supplier.gst_registered ? ' (incl. GST)' : ' (no GST)'}</strong></p>
<p>Kind regards,<br>${theme.companyName}</p>`,
      attachments: [{
        filename: `commission-${supplier.name.replace(/\s+/g, '-').toLowerCase()}-${from}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      }],
    });
    res.json({ message: `Sent to ${supplier.email}`, total_cents: total, jobs: jobCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to send report' });
  }
});

// ── Sales performance ───────────────────────────────────────────────────────
//
// Which statuses count as a win is derived from the admin-ordered pipeline, not
// a fixed list of keys, so renaming or reordering stages keeps working. Sale
// and everything after it (Scheduled - Installation, In Progress, Invoiced,
// Paid…) is won; Awaiting Quote and Quoted are still in play; anything before
// Awaiting Quote — New, Scheduled - Site-Visit, Needs Follow Up — hasn't
// reached a decision yet and is left out of the rate entirely. Cancelled sits
// outside the pipeline and never counts either way.
function salesStatusGroups(statuses) {
  const pipeline = statuses.filter(s => s.key !== 'cancelled');
  const norm = s => (s.label || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const at = test => pipeline.findIndex(s => test(norm(s)));

  const saleIdx = at(l => l === 'sale' || l.startsWith('sale ') || l.endsWith(' sale'));
  const awaitingIdx = at(l => l.includes('awaiting') && l.includes('quote'));
  const quotedIdx = at(l => l === 'quoted');

  return {
    won: saleIdx === -1 ? [] : pipeline.slice(saleIdx).map(s => s.key),
    awaiting: awaitingIdx === -1 ? [] : [pipeline[awaitingIdx].key],
    quoted: quotedIdx === -1 ? [] : [pipeline[quotedIdx].key],
  };
}

router.get('/sales', async (req, res) => {
  const { from, to } = req.query;
  const isAdmin = req.user.role === 'admin';
  try {
    const { rows: settingsRows } = await pool.query(`SELECT value FROM settings WHERE key='job_statuses'`);
    const statuses = settingsRows[0]?.value || DEFAULT_STATUSES;
    const groups = salesStatusGroups(statuses);
    const openKeys = [...groups.awaiting, ...groups.quoted];

    // One sales visit per job — the earliest — so a job booked twice doesn't
    // count twice, and the conversion is credited to whoever first went out.
    const COHORT = `
      SELECT DISTINCT ON (s.job_id) s.job_id, s.user_id
      FROM schedules s
      WHERE s.appointment_type = 'sales'
        AND ($1::date IS NULL OR s.scheduled_date >= $1::date)
        AND ($2::date IS NULL OR s.scheduled_date <= $2::date)
      ORDER BY s.job_id, s.scheduled_date, s.start_time NULLS LAST`;

    const params = [from || null, to || null, groups.won, openKeys, groups.awaiting];
    const userClause = isAdmin ? '' : ' AND u.id = $6';
    if (!isAdmin) params.push(req.user.id);

    const { rows } = await pool.query(
      `WITH cohort AS (${COHORT}),
       appts AS (
         SELECT s.user_id, COUNT(*)::int AS appointments
         FROM schedules s
         WHERE s.appointment_type = 'sales'
           AND ($1::date IS NULL OR s.scheduled_date >= $1::date)
           AND ($2::date IS NULL OR s.scheduled_date <= $2::date)
         GROUP BY s.user_id
       ),
       -- Current backlog ignores the window on purpose: "how many quotes do I
       -- still owe" is a question about now, not about the reporting period.
       backlog AS (
         SELECT c.user_id, COUNT(*)::int AS awaiting_now
         FROM (
           SELECT DISTINCT ON (s.job_id) s.job_id, s.user_id
           FROM schedules s WHERE s.appointment_type = 'sales'
           ORDER BY s.job_id, s.scheduled_date, s.start_time NULLS LAST
         ) c
         JOIN jobs j ON j.id = c.job_id
         WHERE j.status = ANY($5)
         GROUP BY c.user_id
       )
       SELECT u.id AS user_id, u.name,
              COALESCE(a.appointments, 0)                            AS appointments,
              COUNT(ch.job_id)::int                                  AS jobs,
              COUNT(*) FILTER (WHERE j.status = ANY($3))::int        AS won,
              COUNT(*) FILTER (WHERE j.status = ANY($4))::int        AS open_quotes,
              COUNT(*) FILTER (WHERE j.status = ANY($5))::int        AS awaiting_quote,
              COALESCE(b.awaiting_now, 0)                            AS awaiting_now
       FROM users u
       LEFT JOIN appts a    ON a.user_id  = u.id
       LEFT JOIN backlog b  ON b.user_id  = u.id
       LEFT JOIN cohort ch  ON ch.user_id = u.id
       LEFT JOIN jobs j     ON j.id = ch.job_id
       WHERE (a.appointments IS NOT NULL OR b.awaiting_now IS NOT NULL)${userClause}
       GROUP BY u.id, u.name, a.appointments, b.awaiting_now
       ORDER BY won DESC, jobs DESC, u.name`,
      params
    );

    const users = rows.map(r => {
      const decided = r.won + r.open_quotes;
      return {
        user_id: r.user_id, name: r.name,
        appointments: r.appointments,
        jobs: r.jobs,
        won: r.won,
        quoted: r.open_quotes - r.awaiting_quote,
        awaiting_quote: r.awaiting_quote,
        awaiting_now: r.awaiting_now,
        // Undecided jobs are excluded, so a rep whose visits are all still at
        // Site-Visit shows no rate rather than a misleading 0%.
        conversion_rate: decided > 0 ? r.won / decided : null,
      };
    });

    const sum = k => users.reduce((n, u) => n + u[k], 0);
    const totalDecided = sum('won') + sum('awaiting_quote') + sum('quoted');
    res.json({
      from: from || null,
      to: to || null,
      status_groups: groups,
      users,
      totals: {
        appointments: sum('appointments'),
        jobs: sum('jobs'),
        won: sum('won'),
        quoted: sum('quoted'),
        awaiting_quote: sum('awaiting_quote'),
        awaiting_now: sum('awaiting_now'),
        conversion_rate: totalDecided > 0 ? sum('won') / totalDecided : null,
      },
    });
  } catch (err) {
    console.error('Sales report failed:', err);
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
