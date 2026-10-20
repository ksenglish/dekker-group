// Building a price list out of what has actually been bought.
//
// Every supplier invoice scanned onto a job leaves its lines behind in
// job_costs: what the thing was called, what it cost, who sold it and when.
// Years of that is a better price list than any supplier catalogue, for two
// reasons — it is the trade price actually paid rather than a shelf price,
// and it covers the few hundred things the business really buys instead of
// the forty thousand a merchant sells.
//
// What it cannot give is a photograph. Invoices do not carry them, so these
// products arrive without one and pick one up later if a supplier's own file
// is ever imported over the top.
//
// Three things decide what comes out:
//
//   the newest price wins   A line from March and a line from July are the
//                           same product at two prices, and the July one is
//                           what it costs now.
//
//   credits are not prices  A credit note line is a negative amount, which is
//                           a refund and not what the thing is worth.
//
//   one product per thing   Grouped by the shared matcher before anything is
//                           written, so "90x45 H3 4.8m" bought thirty times
//                           is one row rather than thirty.
const pool = require('../db/pool');
const { groupSame, matchProduct, usableSku } = require('./productMatch');

// Cost is held excluding GST — the extractor converts on the way in, so the
// figure on the line is already ex-GST — and sell is cost plus the markup.
const DEFAULT_MARKUP = 0.30;

// Lines below this are rounding, delivery rounding, or a scan misreading a
// column. A product that costs a cent is not a product.
const MIN_COST_CENTS = 1;

// Everything bought, newest first, with the document it came off.
async function readCostHistory({ supplier = null, since = null } = {}) {
  const conditions = ['c.unit_price > 0', 'TRIM(c.description) <> \'\''];
  const params = [];
  let p = 1;
  if (supplier) { conditions.push(`LOWER(TRIM(COALESCE(s.supplier, ''))) = $${p}`); params.push(String(supplier).trim().toLowerCase()); p++; }
  if (since) { conditions.push(`COALESCE(s.invoice_date, c.created_at::date) >= $${p}`); params.push(since); p++; }

  const { rows } = await pool.query(
    `SELECT c.id, c.description, c.sku, c.unit_price, c.created_at,
            s.supplier, s.invoice_number, s.document_type,
            COALESCE(s.invoice_date, c.created_at::date) AS dated,
            j.job_number, j.id AS job_id
       FROM job_costs c
       LEFT JOIN job_cost_scans s ON s.id = c.scan_id
       LEFT JOIN jobs j ON j.id = c.job_id
      WHERE ${conditions.join(' AND ')}
        -- A credit note is money coming back, not a price. Its lines would
        -- otherwise read as the cheapest this product has ever been.
        AND COALESCE(s.document_type, 'invoice') <> 'credit_note'
      ORDER BY dated DESC, c.created_at DESC`,
    params
  );
  return rows;
}

// One row per distinct product, carrying the newest price and what it was
// seen on.
function summarise(history) {
  const groups = groupSame(history, {
    skuOf: r => r.sku, nameOf: r => r.description, supplierOf: r => r.supplier,
  });

  const out = [];
  for (const lines of groups.values()) {
    // readCostHistory ordered by date descending, so the first line of each
    // group is the most recent time this was bought.
    const newest = lines[0];
    if (newest.unit_price < MIN_COST_CENTS) continue;

    const prices = lines.map(l => l.unit_price);
    const previous = lines.find(l => l.unit_price !== newest.unit_price);

    out.push({
      // The name from the most recent invoice, since that is how the supplier
      // writes it now.
      name: String(newest.description).trim(),
      sku: usableSku(newest.sku) ? String(newest.sku).trim() : null,
      supplier: newest.supplier ? String(newest.supplier).trim() : null,
      cost_cents: newest.unit_price,
      last_seen: newest.dated,
      last_invoice: newest.invoice_number,
      job_number: newest.job_number,
      times_bought: lines.length,
      // What it used to cost, when that differs — shown in the preview so a
      // price that has moved is visible before anything is written.
      previous_cost_cents: previous ? previous.unit_price : null,
      previous_seen: previous ? previous.dated : null,
      lowest_cents: Math.min(...prices),
      highest_cents: Math.max(...prices),
    });
  }
  return out;
}

const sellFrom = (costCents, markup) => Math.round(costCents * (1 + markup));

// What importing would do, without doing any of it.
//
// Every row says whether it would create a product or update one, and which
// rule matched it — a price list is not something to write eight hundred rows
// into and find out afterwards.
async function planImport({ supplier = null, since = null, markup = DEFAULT_MARKUP } = {}) {
  const history = await readCostHistory({ supplier, since });
  const summary = summarise(history);

  const plan = [];
  for (const row of summary) {
    const { product, matchedOn } = await matchProduct(
      { sku: row.sku, name: row.name, supplier: row.supplier });
    plan.push({
      ...row,
      sell_cents: sellFrom(row.cost_cents, markup),
      action: product ? 'update' : 'create',
      matched_on: matchedOn,
      existing_id: product ? product.id : null,
      existing_cost_cents: product ? product.cost_price : null,
      // Worth seeing before the write: the price list says one thing and the
      // most recent invoice says another.
      cost_changed: product && product.cost_price != null && product.cost_price !== row.cost_cents,
    });
  }

  return {
    lines_read: history.length,
    products: plan,
    creating: plan.filter(p => p.action === 'create').length,
    updating: plan.filter(p => p.action === 'update').length,
    suppliers: [...new Set(summary.map(s => s.supplier).filter(Boolean))].sort(),
  };
}

module.exports = {
  readCostHistory, summarise, planImport, sellFrom, DEFAULT_MARKUP,
};
