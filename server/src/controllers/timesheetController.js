const pool = require('../db/pool');

// Raw roles (deliberately not normaliseRole — that would elevate sales/
// operations back to office-equivalent, which is exactly what this scoping
// needs to avoid) that only ever see/edit their own timesheet entries.
const SELF_ONLY_ROLES = ['field_tech', 'sales', 'operations', 'subcontractor'];

async function list(req, res) {
  const { job_id, user_id, from, to } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;

  // Field techs, sales, operations and subcontractors can only see their own entries
  if (SELF_ONLY_ROLES.includes(req.user.role)) {
    conditions.push(`t.user_id = $${p}`); params.push(req.user.id); p++;
  } else {
    if (user_id) { conditions.push(`t.user_id = $${p}`); params.push(user_id); p++; }
  }
  if (job_id) { conditions.push(`t.job_id = $${p}`); params.push(job_id); p++; }
  if (from)   { conditions.push(`t.date >= $${p}`); params.push(from); p++; }
  if (to)     { conditions.push(`t.date <= $${p}`); params.push(to); p++; }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const { rows } = await pool.query(
      `SELECT t.*, u.name AS user_name, j.description AS job_title, j.job_number, j.external_ref
       FROM timesheets t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN jobs j ON j.id = t.job_id
       ${where}
       ORDER BY t.date DESC, t.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function create(req, res) {
  const { job_id, date, hours, description, start_time, end_time, source, billing_rate_id } = req.body;
  const user_id = SELF_ONLY_ROLES.includes(req.user.role) ? req.user.id : (req.body.user_id || req.user.id);
  if (!hours || hours <= 0) return res.status(400).json({ error: 'Hours must be greater than 0' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO timesheets (job_id, user_id, date, hours, description, start_time, end_time, source, billing_rate_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [job_id || null, user_id, date || new Date().toISOString().slice(0,10), hours, description || null, start_time || null, end_time || null, source === 'timer' ? 'timer' : 'manual', billing_rate_id || null]
    );
    // Fetch with joins
    const { rows: full } = await pool.query(
      `SELECT t.*, u.name AS user_name, j.description AS job_title, j.job_number, j.external_ref
       FROM timesheets t LEFT JOIN users u ON u.id=t.user_id LEFT JOIN jobs j ON j.id=t.job_id
       WHERE t.id=$1`, [rows[0].id]
    );
    res.status(201).json(full[0]);
  } catch (err) { console.error('Timesheet create error:', err); res.status(500).json({ error: err.message }); }
}

async function update(req, res) {
  const { job_id, date, hours, description, user_id, start_time, end_time, billing_rate_id } = req.body;
  const { id } = req.params;
  try {
    // Field techs, sales, operations and subcontractors can only edit their own
    const { rows: [existing] } = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (SELF_ONLY_ROLES.includes(req.user.role) && existing.user_id !== req.user.id)
      return res.status(403).json({ error: 'Forbidden' });

    const newUserId = SELF_ONLY_ROLES.includes(req.user.role) ? req.user.id : (user_id || existing.user_id);
    const { rows } = await pool.query(
      `UPDATE timesheets SET job_id=$1, user_id=$2, date=$3, hours=$4, description=$5,
         start_time=$6, end_time=$7, billing_rate_id=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [job_id || null, newUserId, date, hours, description || null, start_time || null, end_time || null, billing_rate_id || null, id]
    );
    const { rows: full } = await pool.query(
      `SELECT t.*, u.name AS user_name, j.description AS job_title, j.job_number, j.external_ref
       FROM timesheets t LEFT JOIN users u ON u.id=t.user_id LEFT JOIN jobs j ON j.id=t.job_id
       WHERE t.id=$1`, [rows[0].id]
    );
    res.json(full[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function remove(req, res) {
  try {
    const { rows: [existing] } = await pool.query('SELECT * FROM timesheets WHERE id=$1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (SELF_ONLY_ROLES.includes(req.user.role) && existing.user_id !== req.user.id)
      return res.status(403).json({ error: 'Forbidden' });
    await pool.query('DELETE FROM timesheets WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function summary(req, res) {
  const { from, to, user_id } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;
  if (SELF_ONLY_ROLES.includes(req.user.role)) { conditions.push(`t.user_id=$${p}`); params.push(req.user.id); p++; }
  else if (user_id) { conditions.push(`t.user_id=$${p}`); params.push(user_id); p++; }
  if (from) { conditions.push(`t.date>=$${p}`); params.push(from); p++; }
  if (to)   { conditions.push(`t.date<=$${p}`); params.push(to); p++; }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const { rows } = await pool.query(
      `SELECT u.name AS user_name, u.id AS user_id,
              SUM(t.hours) AS total_hours,
              COUNT(DISTINCT t.job_id) AS job_count
       FROM timesheets t LEFT JOIN users u ON u.id=t.user_id
       ${where}
       GROUP BY u.id, u.name ORDER BY u.name`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

// ── Job time summary ────────────────────────────────────────────────────────
// Hours on a job broken down by billing rate, plus — for admins only — what
// those hours cost, what they can be charged for, and the difference.
//
// Scoped exactly like list() above: someone who only sees their own entries in
// the timeline gets a summary of only their own entries, so the totals always
// add up to the bars actually on screen.

const DEFAULT_BILLING_RATES = [
  { id: 'standard', label: 'Standard', rate: 0 },
];

async function getBillingRates() {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key='billing_rates'`);
  const value = rows[0]?.value;
  return Array.isArray(value) && value.length ? value : DEFAULT_BILLING_RATES;
}

// Mirrors client/src/lib/billing.js: an entry is billable when it is on a job
// and its rate actually charges. A rate of $0 — Travel, typically — is time
// worth recording but not worth billing.
function rateOf(entry, rates) {
  if (!entry.billing_rate_id) return null;
  return rates.find(r => r.id === entry.billing_rate_id) || null;
}

async function jobSummary(req, res) {
  const jobId = req.params.id;
  const isAdmin = req.user.role === 'admin';
  const params = [jobId];
  let where = 't.job_id = $1';
  if (SELF_ONLY_ROLES.includes(req.user.role)) {
    params.push(req.user.id);
    where += ` AND t.user_id = $${params.length}`;
  }

  try {
    const [rates, { rows }] = await Promise.all([
      getBillingRates(),
      pool.query(
        `SELECT t.id, t.hours, t.billing_rate_id, t.user_id,
                u.name AS user_name, u.cost_rate
           FROM timesheets t
           LEFT JOIN users u ON u.id = t.user_id
          WHERE ${where}`,
        params
      ),
    ]);

    // One line per rate that has hours against it, in the order the rates are
    // configured, so the breakdown reads the same way as the Settings list.
    const buckets = new Map();
    const bucketFor = (key, label, rate) => {
      if (!buckets.has(key)) buckets.set(key, { id: key, label, rate, hours: 0, charge: 0, billable: rate > 0 });
      return buckets.get(key);
    };
    rates.forEach(r => bucketFor(r.id, r.label, parseFloat(r.rate) || 0));

    let totalHours = 0, billableHours = 0, charge = 0, cost = 0;
    const byUser = new Map();

    for (const e of rows) {
      const hours = parseFloat(e.hours) || 0;
      totalHours += hours;

      const rate = rateOf(e, rates);
      // An entry with no rate chosen is still worked time, so it has to appear
      // somewhere — it just cannot be charged until someone picks a rate.
      const b = rate
        ? bucketFor(rate.id, rate.label, parseFloat(rate.rate) || 0)
        : bucketFor('__unrated', 'No rate selected', 0);
      b.hours += hours;

      const hourly = rate ? (parseFloat(rate.rate) || 0) : 0;
      if (hourly > 0) { billableHours += hours; b.charge += hours * hourly; charge += hours * hourly; }

      const userCost = e.cost_rate == null ? null : parseFloat(e.cost_rate);
      if (userCost != null) cost += hours * userCost;

      const u = byUser.get(e.user_id) || { user_id: e.user_id, name: e.user_name, hours: 0, cost_rate: userCost, cost: 0 };
      u.hours += hours;
      if (userCost != null) u.cost += hours * userCost;
      byUser.set(e.user_id, u);
    }

    const round2 = n => Math.round(n * 100) / 100;
    const breakdown = [...buckets.values()]
      .filter(b => b.hours > 0)
      .map(b => ({ ...b, hours: round2(b.hours), charge: round2(b.charge) }));

    const payload = {
      entry_count: rows.length,
      total_hours: round2(totalHours),
      billable_hours: round2(billableHours),
      non_billable_hours: round2(totalHours - billableHours),
      rates: breakdown,
    };

    // Money is admin-only, and it is left off the payload entirely rather than
    // zeroed — a zero would read as "this job made nothing".
    if (isAdmin) {
      // Anyone without a cost rate set contributes no cost, which would quietly
      // overstate profit. Name them so the figure can be read for what it is.
      const missing = [...byUser.values()].filter(u => u.cost_rate == null && u.hours > 0);
      payload.financials = {
        cost: round2(cost),
        charge: round2(charge),
        gross_profit: round2(charge - cost),
        margin_pct: charge > 0 ? round2(((charge - cost) / charge) * 100) : null,
        by_user: [...byUser.values()]
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .map(u => ({ ...u, hours: round2(u.hours), cost: round2(u.cost) })),
        missing_cost_rate: missing.map(u => u.name).filter(Boolean),
      };
    }
    res.json(payload);
  } catch (err) {
    console.error('[timesheets] job summary failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { list, create, update, remove, summary, jobSummary };
