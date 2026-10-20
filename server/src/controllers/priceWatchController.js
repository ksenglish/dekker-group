// Building the price list from what was bought, and noticing when a price moves.
//
// Two sides of the same data. The invoices say what things cost; the price
// list says what they are sold for. Keeping the first out of the second is
// how a job gets quoted at last year's cost.
const pool = require('../db/pool');
const { planImport, sellFrom, DEFAULT_MARKUP } = require('../services/costsToPriceList');
const { usableSku } = require('../services/productMatch');

const CATEGORY = 'Supplier Purchases';

function markupFrom(raw) {
  const n = Number(raw);
  // A markup is a percentage above cost. Anything outside this is a typo —
  // 3000% is not a price list, and a negative markup sells at a loss.
  if (!Number.isFinite(n) || n < 0 || n > 500) return DEFAULT_MARKUP;
  return n / 100;
}

// GET — what building the price list from the invoices would do.
async function previewFromCosts(req, res) {
  try {
    const plan = await planImport({
      supplier: req.query.supplier || null,
      since: req.query.since || null,
      markup: markupFrom(req.query.markup),
    });
    res.json(plan);
  } catch (err) {
    console.error('[price watch] preview failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

// POST — do it.
//
// Products are created or updated one at a time rather than in a single
// statement, because each one has to be matched first and the match depends
// on what has already been written in this run.
async function applyFromCosts(req, res) {
  const markup = markupFrom(req.body?.markup);
  const onlyNew = req.body?.only_new === true;
  try {
    const plan = await planImport({
      supplier: req.body?.supplier || null,
      since: req.body?.since || null,
      markup,
    });

    const result = { created: 0, updated: 0, skipped: 0, errors: [] };
    for (const row of plan.products) {
      if (onlyNew && row.action === 'update') { result.skipped++; continue; }
      try {
        if (row.action === 'update') {
          await pool.query(
            `UPDATE products
                SET cost_price = $1,
                    unit_price = $2,
                    -- Only filled in, never overwritten: a code typed by hand
                    -- or taken from a supplier's own file is better than one
                    -- read off a scan.
                    sku = COALESCE(NULLIF(TRIM(COALESCE(sku, '')), ''), $3),
                    supplier = COALESCE(NULLIF(TRIM(COALESCE(supplier, '')), ''), $4),
                    updated_at = NOW()
              WHERE id = $5`,
            [row.cost_cents, row.sell_cents, row.sku, row.supplier, row.existing_id]
          );
          result.updated++;
        } else {
          await pool.query(
            `INSERT INTO products (name, sku, category, unit, cost_price, unit_price, supplier, description)
             VALUES ($1,$2,$3,'each',$4,$5,$6,$7)`,
            [row.name, row.sku, CATEGORY, row.cost_cents, row.sell_cents, row.supplier,
             `From ${row.supplier || 'a supplier'} invoice${row.last_invoice ? ` ${row.last_invoice}` : ''}, ${row.last_seen}.`]
          );
          result.created++;
        }
      } catch (e) {
        result.errors.push(`${row.name}: ${e.message}`);
      }
    }
    res.json({ ...result, markup_pct: Math.round(markup * 100), lines_read: plan.lines_read });
  } catch (err) {
    console.error('[price watch] import failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── The red flag report ──────────────────────────────────────────────────────
//
// A supplier puts a price up and nothing says so. The invoice is scanned onto
// a job, the cost goes into that job's figures, and the price list carries on
// saying what the thing used to cost — so every quote raised from it is
// costed at the old price and the margin quietly disappears.
//
// So: every product on the price list, against the most recent invoice line
// that refers to it, and the difference between the two.
async function priceChanges(req, res) {
  const threshold = Math.max(0, Number(req.query.threshold_pct) || 0);
  const since = req.query.since || null;
  try {
    const { rows } = await pool.query(
      `
      WITH lines AS (
        SELECT c.description, c.sku, c.unit_price, c.job_id,
               s.supplier, s.invoice_number,
               COALESCE(s.invoice_date, c.created_at::date) AS dated
          FROM job_costs c
          LEFT JOIN job_cost_scans s ON s.id = c.scan_id
         WHERE c.unit_price > 0
           AND COALESCE(s.document_type, 'invoice') <> 'credit_note'
           AND ($1::date IS NULL OR COALESCE(s.invoice_date, c.created_at::date) >= $1::date)
      ),
      -- Each invoice line matched to a product the same way everything else
      -- matches: on the supplier's code within that supplier, or on the name.
      matched AS (
        SELECT p.id AS product_id, p.name, p.sku AS product_sku, p.supplier AS product_supplier,
               p.cost_price, p.unit_price AS sell_price,
               l.unit_price AS invoiced_cost, l.dated, l.invoice_number, l.supplier AS invoice_supplier,
               l.job_id,
               ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY l.dated DESC) AS recency
          FROM products p
          JOIN lines l
            ON (
                 NULLIF(TRIM(LOWER(COALESCE(p.sku, ''))), '') IS NOT NULL
                 AND TRIM(LOWER(COALESCE(p.sku, ''))) = TRIM(LOWER(COALESCE(l.sku, '')))
                 AND TRIM(LOWER(COALESCE(p.supplier, ''))) = TRIM(LOWER(COALESCE(l.supplier, '')))
               )
            OR TRIM(LOWER(p.name)) = TRIM(LOWER(l.description))
      )
      SELECT product_id, name, product_sku, product_supplier, cost_price, sell_price,
             invoiced_cost, dated, invoice_number, invoice_supplier, job_id
        FROM matched
       WHERE recency = 1
         AND cost_price IS NOT NULL
         AND cost_price > 0
         AND invoiced_cost <> cost_price
       ORDER BY ABS(invoiced_cost - cost_price)::numeric / NULLIF(cost_price, 0) DESC
      `,
      [since]
    );

    const changes = rows.map(r => {
      const changeCents = r.invoiced_cost - r.cost_price;
      const changePct = (changeCents / r.cost_price) * 100;
      return {
        product_id: r.product_id,
        name: r.name,
        sku: usableSku(r.product_sku) ? r.product_sku : null,
        supplier: r.product_supplier || r.invoice_supplier || null,
        price_list_cost: r.cost_price,
        invoiced_cost: r.invoiced_cost,
        change_cents: changeCents,
        change_pct: Number(changePct.toFixed(1)),
        direction: changeCents > 0 ? 'up' : 'down',
        // What the sell price would be if the markup were held — so the
        // decision is "put the price up to this" rather than arithmetic.
        sell_now: r.sell_price,
        sell_to_hold_markup: r.cost_price > 0 && r.sell_price > 0
          ? Math.round(r.invoiced_cost * (r.sell_price / r.cost_price))
          : null,
        // What the margin has quietly become, selling at the old price with
        // the new cost.
        margin_now_pct: r.sell_price > 0
          ? Number((((r.sell_price - r.invoiced_cost) / r.sell_price) * 100).toFixed(1))
          : null,
        last_invoice: r.invoice_number,
        last_seen: r.dated,
        job_id: r.job_id,
      };
    }).filter(c => Math.abs(c.change_pct) >= threshold);

    res.json({
      threshold_pct: threshold,
      total: changes.length,
      went_up: changes.filter(c => c.direction === 'up').length,
      went_down: changes.filter(c => c.direction === 'down').length,
      // Selling below cost is the one that cannot wait.
      selling_at_a_loss: changes.filter(c => c.margin_now_pct !== null && c.margin_now_pct < 0).length,
      changes,
    });
  } catch (err) {
    console.error('[price watch] report failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

// Accepting a new cost: the price list takes the invoiced figure, and the
// sell price moves with it so the markup is held.
async function acceptPrice(req, res) {
  try {
    const { rows: [product] } = await pool.query(
      'SELECT cost_price, unit_price FROM products WHERE id=$1', [req.params.id]);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const newCost = Math.round(Number(req.body?.cost_price));
    if (!Number.isFinite(newCost) || newCost <= 0) {
      return res.status(400).json({ error: 'A new cost is required' });
    }
    // Hold whatever markup this product actually had, rather than assuming the
    // default — some things are sold at a different one on purpose.
    const ratio = product.cost_price > 0 && product.unit_price > 0
      ? product.unit_price / product.cost_price
      : 1 + DEFAULT_MARKUP;
    const newSell = req.body?.unit_price != null
      ? Math.round(Number(req.body.unit_price))
      : Math.round(newCost * ratio);

    const { rows } = await pool.query(
      `UPDATE products SET cost_price=$1, unit_price=$2, updated_at=NOW()
        WHERE id=$3 RETURNING id, name, cost_price, unit_price`,
      [newCost, newSell, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[price watch] accept failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { previewFromCosts, applyFromCosts, priceChanges, acceptPrice, sellFrom };
