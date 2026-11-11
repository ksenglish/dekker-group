const pool = require('../db/pool');
const { can } = require('../utils/permissions');
const diary = require('../services/timeAgainstDiary');
const timeWarning = require('../services/timeWarningEmail');
const { appUrl } = require('../utils/appUrl');

// Raw roles (deliberately not normaliseRole — that would elevate sales/
// operations back to office-equivalent, which is exactly what this scoping
// needs to avoid) that only ever see/edit their own timesheet entries.
const SELF_ONLY_ROLES = ['field_tech', 'sales', 'operations', 'subcontractor'];

// Pinned to their own entries — unless they've been given the whole team's
// time, which is the one thing that lifts it.
function selfOnly(user) {
  return SELF_ONLY_ROLES.includes(user.role) && !can(user, 'timesheets.all');
}

// Hours that have to belong to a job.
//
// Labour is work done for somebody, and work done for somebody belongs on
// their job — hours logged against nothing are hours nobody can bill, check
// or explain, and they are where the wrong-job problem hides. So a rate
// requires a job unless it has been marked otherwise in Settings → Billing
// Rates, which is for the handful that genuinely are not job work: travel
// between sites, yard time, leave.
//
// Required by default, including for an entry with no rate chosen at all. A
// rate added later and never thought about should ask for a job rather than
// quietly become the way round this.
async function rateAllowsNoJob(rateId) {
  if (!rateId) return false;
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key='billing_rates'`);
    const rate = (rows[0]?.value || []).find(r => r.id === rateId);
    return rate?.requires_job === false;
  } catch { return false; }
}

// What the diary makes of an entry that has not been written yet.
//
// Asked before the insert, not after, because the person is given the
// choice to drop it: hours they think better of should never have reached
// the office's inbox, and an email saying "ignore the last one" is worse
// than no email.
//
// A check that falls over is not allowed to stop anybody working. It comes
// back as "nothing to say", the entry saves as it always did, and the error
// goes to the log for somebody else to deal with.
async function askTheDiary({ jobId, userId, date, startTime, endTime, hours }) {
  if (!jobId) return null;
  try {
    return await diary.check({ jobId, userId, date, startTime, endTime, hours });
  } catch (err) {
    console.error('[timesheets] diary check failed:', err.message);
    return null;
  }
}

// Said out loud, once the entry exists and the person has chosen to keep it:
// kept on the row so it can be found later, and emailed to the office.
async function recordWarning(entry, warning) {
  try {
    await pool.query(
      `UPDATE timesheets SET schedule_warning = $1,
              schedule_warned_at = CASE WHEN $1::text IS NULL THEN NULL ELSE NOW() END
        WHERE id = $2`,
      [warning, entry.id]);
  } catch (err) { console.error('[timesheets] could not record the warning:', err.message); }

  if (warning) {
    const bookings = await diary
      .bookingsFor({ userId: entry.user_id, date: entry.date })
      .catch(() => []);
    // Not awaited into the response: the person has already been told on
    // screen, and the office being emailed is not something they wait for.
    timeWarning.notify({ entry, warning, bookings, appUrl: appUrl() })
      .catch(err => console.error('[timesheets] notify failed:', err.message));
  }
  return warning;
}

// The 409 that asks. Nothing has been written at this point, and nothing has
// been sent — saying yes is what does both.
const askFirst = (res, warning) => res.status(409).json({
  needs_confirmation: true,
  warning,
  error: warning,
});

// The day a person may log time for.
//
// Hours typed in days later are hours remembered rather than recorded, and
// they are what turn up on a job after it has been invoiced. So the field is
// today for everyone except the people whose job it is to fix the others'
// mistakes — who need every date there is, including the ones in the past.
const BACKDATE_ROLES = ['admin', 'office'];
const mayBackdate = user => BACKDATE_ROLES.includes(user?.role) || can(user, 'timesheets.all');

// Today where the work happens, not where the server is.
const todayHere = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: process.env.BUSINESS_TIMEZONE || 'Pacific/Auckland' }).format(new Date());

async function list(req, res) {
  const { job_id, user_id, from, to } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;

  // Field techs, sales, operations and subcontractors can only see their own entries
  if (selfOnly(req.user)) {
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
  const user_id = selfOnly(req.user) ? req.user.id : (req.body.user_id || req.user.id);
  if (!hours || hours <= 0) return res.status(400).json({ error: 'Hours must be greater than 0' });
  if (!job_id && !await rateAllowsNoJob(billing_rate_id)) {
    return res.status(400).json({
      error: 'Pick the job these hours were worked on. Hours that are not job'
        + ' work — travel, yard time, leave — need a billing rate set up for'
        + ' that in Settings → Billing Rates.',
      needs_job: true,
    });
  }
  const day = date || todayHere();
  if (day !== todayHere() && !mayBackdate(req.user)) {
    return res.status(403).json({
      error: 'Time can only be logged for today. Ask the office to add hours'
        + ' for another day.',
      today_only: true,
    });
  }
  const warning = await askTheDiary({
    jobId: job_id, userId: user_id, date: day,
    startTime: start_time, endTime: end_time, hours,
  });
  // Offered back before it is written. Saying no leaves no entry, no warning
  // on anything, and nothing in the office's inbox.
  if (warning && req.body?.acknowledged !== true) return askFirst(res, warning);

  try {
    const { rows } = await pool.query(
      `INSERT INTO timesheets (job_id, user_id, date, hours, description, start_time, end_time, source, billing_rate_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [job_id || null, user_id, day, hours, description || null, start_time || null, end_time || null, source === 'timer' ? 'timer' : 'manual', billing_rate_id || null]
    );
    // Fetch with joins
    const { rows: full } = await pool.query(
      `SELECT t.*, u.name AS user_name, j.description AS job_title, j.job_number, j.external_ref
       FROM timesheets t LEFT JOIN users u ON u.id=t.user_id LEFT JOIN jobs j ON j.id=t.job_id
       WHERE t.id=$1`, [rows[0].id]
    );
    // Kept and told, now that it exists and they have said to keep it.
    await recordWarning(full[0], warning);
    res.status(201).json({ ...full[0], schedule_warning: warning, warning });
  } catch (err) { console.error('Timesheet create error:', err); res.status(500).json({ error: err.message }); }
}

async function update(req, res) {
  const { job_id, date, hours, description, user_id, start_time, end_time, billing_rate_id } = req.body;
  const { id } = req.params;
  try {
    // Field techs, sales, operations and subcontractors can only edit their own
    const { rows: [existing] } = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (selfOnly(req.user) && existing.user_id !== req.user.id)
      return res.status(403).json({ error: 'Forbidden' });

    const newUserId = selfOnly(req.user) ? req.user.id : (user_id || existing.user_id);
    // The same rule on an edit, or yesterday is one amendment away.
    if (date && String(date).slice(0, 10) !== todayHere() && !mayBackdate(req.user)) {
      return res.status(403).json({
        error: 'Time can only be logged for today. Ask the office to change'
          + ' hours on another day.',
        today_only: true,
      });
    }
    if (!job_id && !await rateAllowsNoJob(billing_rate_id)) {
      return res.status(400).json({
        error: 'Pick the job these hours were worked on. Hours that are not job'
          + ' work — travel, yard time, leave — need a billing rate set up for'
          + ' that in Settings → Billing Rates.',
        needs_job: true,
      });
    }
    const warning = await askTheDiary({
      jobId: job_id, userId: newUserId, date,
      startTime: start_time, endTime: end_time, hours,
    });
    if (warning && req.body?.acknowledged !== true) return askFirst(res, warning);

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
    // Moved to another job, or its times amended, is exactly when an entry
    // stops or starts matching the diary — so the answer is written back,
    // which is also how correcting one clears the warning off it.
    await recordWarning(full[0], warning);
    res.json({ ...full[0], schedule_warning: warning, warning });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function remove(req, res) {
  try {
    const { rows: [existing] } = await pool.query('SELECT * FROM timesheets WHERE id=$1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (selfOnly(req.user) && existing.user_id !== req.user.id)
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
  if (selfOnly(req.user)) { conditions.push(`t.user_id=$${p}`); params.push(req.user.id); p++; }
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
  if (selfOnly(req.user)) {
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

// ── Timers running right now ────────────────────────────────────────────────
//
// The timer used to live entirely in one browser's storage, so nobody else
// could see it: not the office, not the next phone the same person picked
// up. A timer left running over a weekend was invisible until it produced
// sixty hours on the Monday.

// Started. One row per person — starting one on another job moves them,
// which is what has actually happened.
async function startTimer(req, res) {
  const { job_id, billing_rate_id } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'Which job?' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO active_timers (user_id, job_id, billing_rate_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE
          SET job_id = EXCLUDED.job_id,
              billing_rate_id = EXCLUDED.billing_rate_id,
              -- Moving to another job restarts the clock; carrying on with
              -- the same one keeps it, so a page reload is not a reset.
              started_at = CASE WHEN active_timers.job_id = EXCLUDED.job_id
                                THEN active_timers.started_at ELSE NOW() END,
              updated_at = NOW()
       RETURNING *`,
      [req.user.id, job_id, billing_rate_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[timers] start failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

// Stopped — saved or discarded, both of which end the running timer. The
// hours themselves are a timesheet entry and go in separately.
async function stopTimer(req, res) {
  try {
    await pool.query('DELETE FROM active_timers WHERE user_id = $1', [req.user.id]);
    res.json({ stopped: true });
  } catch (err) {
    console.error('[timers] stop failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

// Who is on the clock. Scoped like everything else here: somebody who only
// sees their own timesheet sees only their own timer, unless they are
// asking about one job, where knowing who else is on site is the point.
async function listTimers(req, res) {
  const { job_id } = req.query;
  const where = [];
  const params = [];
  if (job_id) { params.push(job_id); where.push(`t.job_id = $${params.length}`); }
  else if (selfOnly(req.user)) { params.push(req.user.id); where.push(`t.user_id = $${params.length}`); }
  try {
    const { rows } = await pool.query(
      `SELECT t.user_id, t.job_id, t.started_at, t.billing_rate_id,
              u.name AS user_name,
              j.job_number, j.external_ref, j.description AS job_title,
              c.name AS customer_name
         FROM active_timers t
         JOIN users u ON u.id = t.user_id
         JOIN jobs j ON j.id = t.job_id
         LEFT JOIN customers c ON c.id = j.customer_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.started_at`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[timers] list failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  list, create, update, remove, summary, jobSummary,
  startTimer, stopTimer, listTimers,
};
