const pool = require('../db/pool');
const { findJobType } = require('../services/jobTypes');
const { getDefaultTheme } = require('../utils/documentThemes');

// Turning a job's costs and hours into things you can charge for, and turning
// the resulting line items into an invoice.
//
// Money is in integer cents excluding GST throughout — the same convention
// line_items, job_costs and the billing rates already use. GST is added once,
// at the end, when the invoice totals are worked out.

const GST_RATE = 0.15;

const DEFAULT_BILLING_RATES = [{ id: 'standard', label: 'Standard', rate: 0 }];

async function getBillingRates() {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key='billing_rates'`);
  const value = rows[0]?.value;
  return Array.isArray(value) && value.length ? value : DEFAULT_BILLING_RATES;
}

// ── What's available to bill ────────────────────────────────────────────────

// Every cost and every hour on the job, with a suggested sell price, and a
// note of anything already added so the same work can't be billed twice
// without the office meaning to.
async function listBillable(req, res) {
  const jobId = req.params.id;
  try {
    const rates = await getBillingRates();
    const rateById = new Map(rates.map(r => [r.id, r]));

    const [{ rows: costs }, { rows: time }] = await Promise.all([
      pool.query(
        `SELECT c.id, c.description, c.quantity, c.unit_price, c.billed_at,
                s.supplier, s.invoice_number
           FROM job_costs c
           LEFT JOIN job_cost_scans s ON s.id = c.scan_id
          WHERE c.job_id = $1
          ORDER BY c.sort_order, c.created_at`,
        [jobId]
      ),
      pool.query(
        `SELECT t.id, t.date, t.hours, t.description, t.billing_rate_id, t.billed_at,
                u.name AS user_name, u.default_billing_rate_id
           FROM timesheets t
           LEFT JOIN users u ON u.id = t.user_id
          WHERE t.job_id = $1
          ORDER BY t.date, t.created_at`,
        [jobId]
      ),
    ]);

    res.json({
      // Rates travel with the payload so the picker can offer them without a
      // second round trip, and so the labels match what the server will use.
      billing_rates: rates.map(r => ({ id: r.id, label: r.label, rate: parseFloat(r.rate) || 0 })),
      costs: costs.map(c => ({
        id: c.id,
        description: c.description,
        quantity: parseFloat(c.quantity) || 1,
        unit_cost: c.unit_price,
        total_cost: Math.round((parseFloat(c.quantity) || 1) * c.unit_price),
        supplier: c.supplier,
        invoice_number: c.invoice_number,
        billed_at: c.billed_at,
      })),
      time: time.map(t => {
        // The rate the entry was logged against, else the one set on that
        // person's user record. Neither being set is not an error — the picker
        // says so and the office chooses.
        const rate = rateById.get(t.billing_rate_id) || rateById.get(t.default_billing_rate_id) || null;
        return {
          id: t.id,
          date: t.date,
          hours: parseFloat(t.hours) || 0,
          description: t.description,
          user_name: t.user_name,
          billing_rate_id: rate?.id || null,
          billing_rate_label: rate?.label || null,
          // Whether the rate came off the entry itself or the person's default,
          // so the picker can say which.
          rate_source: rateById.get(t.billing_rate_id) ? 'entry'
            : rateById.get(t.default_billing_rate_id) ? 'user_default' : null,
          hourly_rate: rate ? Math.round((parseFloat(rate.rate) || 0) * 100) : 0,
          billed_at: t.billed_at,
        };
      }),
    });
  } catch (err) {
    console.error('[job billing] listing what can be billed failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── Adding them to the line items ───────────────────────────────────────────

// A sell price from a cost: either a percentage on top, or a price typed in
// outright. Returned in cents excl. GST, rounded once at the end so a markup
// on a long list doesn't drift a cent per line.
function sellPriceFromCost(unitCostCents, pricing) {
  if (pricing && pricing.mode === 'price') {
    const cents = Math.round((parseFloat(pricing.unit_price) || 0) * 100);
    return Math.max(0, cents);
  }
  const markup = Math.max(-100, parseFloat(pricing?.markup_pct) || 0);
  return Math.max(0, Math.round(unitCostCents * (1 + markup / 100)));
}

const round2 = n => Math.round(n * 100) / 100;

// Appends to the job's line items rather than replacing them — the editor's
// own save is a replace-all, and this has to be able to add to a list someone
// has already built by hand.
async function addToLineItems(req, res) {
  const jobId = req.params.id;
  const costs = Array.isArray(req.body?.costs) ? req.body.costs : [];
  const time = Array.isArray(req.body?.time) ? req.body.time : [];
  if (!costs.length && !time.length) {
    return res.status(400).json({ error: 'Nothing selected to add' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [job] } = await client.query('SELECT id FROM jobs WHERE id=$1', [jobId]);
    if (!job) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Job not found' }); }

    const added = [];

    if (costs.length) {
      const ids = costs.map(c => c.id).filter(Boolean);
      const { rows } = await client.query(
        'SELECT * FROM job_costs WHERE job_id=$1 AND id = ANY($2::uuid[])', [jobId, ids]
      );
      const byId = new Map(rows.map(r => [r.id, r]));
      for (const sel of costs) {
        const cost = byId.get(sel.id);
        // Silently skipping a cost from another job is the safe read of a
        // stale picker — it is not the office's mistake to be told about.
        if (!cost) continue;
        const qty = parseFloat(cost.quantity) || 1;
        const unit = sellPriceFromCost(cost.unit_price, sel);
        await client.query(
          `INSERT INTO line_items (job_id, description, quantity, unit_price) VALUES ($1,$2,$3,$4)`,
          [jobId, (sel.description || cost.description || '').trim() || cost.description, qty, unit]
        );
        added.push({ kind: 'cost', id: cost.id, unit_price: unit, quantity: qty });
      }
      const done = added.filter(a => a.kind === 'cost').map(a => a.id);
      if (done.length) {
        await client.query('UPDATE job_costs SET billed_at = NOW() WHERE id = ANY($1::uuid[])', [done]);
      }
    }

    if (time.length) {
      const ids = time.map(t => t.id).filter(Boolean);
      const { rows } = await client.query(
        'SELECT * FROM timesheets WHERE job_id=$1 AND id = ANY($2::uuid[])', [jobId, ids]
      );
      const byId = new Map(rows.map(r => [r.id, r]));
      const rates = await getBillingRates();
      const rateById = new Map(rates.map(r => [r.id, r]));

      // Hours can be billed line by line, or rolled into one line per rate —
      // a customer rarely wants to read fourteen quarter-hour entries.
      const group = req.body?.group_time === true;
      const lines = new Map();

      for (const sel of time) {
        const entry = byId.get(sel.id);
        if (!entry) continue;
        const hours = parseFloat(entry.hours) || 0;
        if (hours <= 0) continue;

        const rate = rateById.get(sel.billing_rate_id) || rateById.get(entry.billing_rate_id) || null;
        const unit = sel.unit_price != null
          ? Math.max(0, Math.round((parseFloat(sel.unit_price) || 0) * 100))
          : Math.max(0, Math.round((parseFloat(rate?.rate) || 0) * 100));
        const label = (sel.description || '').trim()
          || `${rate?.label || 'Labour'} — ${entry.description || 'on site'}`;

        const key = group ? `${rate?.id || 'none'}|${unit}` : `${entry.id}`;
        const line = lines.get(key) || { description: group ? (rate?.label || 'Labour') : label, hours: 0, unit, ids: [] };
        line.hours += hours;
        line.ids.push(entry.id);
        lines.set(key, line);
      }

      for (const line of lines.values()) {
        await client.query(
          `INSERT INTO line_items (job_id, description, quantity, unit_price) VALUES ($1,$2,$3,$4)`,
          [jobId, line.description, round2(line.hours), line.unit]
        );
        line.ids.forEach(id => added.push({ kind: 'time', id, unit_price: line.unit, quantity: round2(line.hours) }));
      }

      const done = added.filter(a => a.kind === 'time').map(a => a.id);
      if (done.length) {
        await client.query('UPDATE timesheets SET billed_at = NOW() WHERE id = ANY($1::uuid[])', [done]);
      }
    }

    await client.query('COMMIT');

    const { rows: items } = await pool.query(
      'SELECT * FROM line_items WHERE job_id=$1 AND quote_id IS NULL ORDER BY created_at', [jobId]
    );
    res.status(201).json({
      added_costs: added.filter(a => a.kind === 'cost').length,
      added_time: added.filter(a => a.kind === 'time').length,
      line_items: items,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[job billing] adding to line items failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

// ── Invoicing them ──────────────────────────────────────────────────────────

// Raises a draft invoice straight from the job's line items, with no quote in
// between. Converting an accepted quote still works and is unchanged; this is
// for the work that was never quoted — a callout, a repair, time and materials.
async function createInvoiceFromLineItems(req, res) {
  const jobId = req.params.id;
  try {
    const { rows: [job] } = await pool.query(
      'SELECT id, customer_id, type, status FROM jobs WHERE id=$1', [jobId]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.customer_id) return res.status(400).json({ error: 'This job has no customer to invoice' });

    const { rows: items } = await pool.query(
      'SELECT quantity, unit_price FROM line_items WHERE job_id=$1 AND quote_id IS NULL', [jobId]
    );
    if (!items.length) {
      return res.status(400).json({ error: 'Add some line items first — there is nothing to invoice' });
    }

    // Cents throughout, GST applied to the rounded subtotal so the invoice adds
    // up exactly as the line items do on screen.
    const subtotal = items.reduce((s, i) => s + Math.round((parseFloat(i.quantity) || 0) * i.unit_price), 0);
    const gst = Math.round(subtotal * GST_RATE);
    const total = subtotal + gst;

    // Same precedence quoting uses: the theme set against this job's type,
    // else the global default.
    let themeId = req.body?.theme_id || null;
    if (!themeId) {
      const jobType = job.type ? await findJobType(job.type) : null;
      themeId = jobType?.theme_id || (await getDefaultTheme())?.id || null;
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const { rows } = await pool.query(
      `INSERT INTO invoices (job_id, quote_id, customer_id, status, subtotal, gst, total, due_date, theme_id)
       VALUES ($1, NULL, $2, 'draft', $3, $4, $5, $6, $7) RETURNING *`,
      [jobId, job.customer_id, subtotal, gst, total, dueDate.toISOString().split('T')[0], themeId]
    );

    // Same forward-only move a converted quote makes, and for the same reason:
    // a job that has been billed is past the work.
    if (job.status !== 'complete' && job.status !== 'cancelled') {
      await pool.query(`UPDATE jobs SET status='invoiced', updated_at=NOW() WHERE id=$1`, [jobId]);
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[job billing] creating an invoice failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { listBillable, addToLineItems, createInvoiceFromLineItems, sellPriceFromCost };
