const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const productMatch = require('../services/productMatch');

router.use(authenticate);

// Applies a delta to a location's on-hand figure and records why.
//
// Quantities are allowed to go negative. On site people take what they need and
// reconcile later; refusing the scan would just mean the movement goes
// unrecorded and the count drifts further. Negatives surface in red on the
// Stock report so they get corrected.
async function moveStock(client, { productId, fromId, toId, quantity, reason, jobId, userId }) {
  // The casts are load-bearing: without them Postgres cannot infer a type for a
  // parameter sitting under a unary minus, and the statement fails to prepare.
  if (fromId) {
    await client.query(
      `INSERT INTO stock_levels (location_id, product_id, quantity, updated_at)
       VALUES ($1, $2, -($3::numeric), NOW())
       ON CONFLICT (location_id, product_id)
       DO UPDATE SET quantity = stock_levels.quantity - $3::numeric, updated_at = NOW()`,
      [fromId, productId, quantity]
    );
  }
  if (toId) {
    await client.query(
      `INSERT INTO stock_levels (location_id, product_id, quantity, updated_at)
       VALUES ($1, $2, $3::numeric, NOW())
       ON CONFLICT (location_id, product_id)
       DO UPDATE SET quantity = stock_levels.quantity + $3::numeric, updated_at = NOW()`,
      [toId, productId, quantity]
    );
  }
  await client.query(
    `INSERT INTO stock_movements (product_id, from_location_id, to_location_id, job_id, quantity, reason, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [productId, fromId || null, toId || null, jobId || null, quantity, reason, userId]
  );
}

// ── Locations ────────────────────────────────────────────────────────────────

router.get('/locations', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*,
              COALESCE((
                SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
                FROM stock_location_users lu JOIN users u ON u.id = lu.user_id
                WHERE lu.location_id = l.id
              ), '[]'::json) AS users
       FROM stock_locations l
       WHERE l.is_active
       ORDER BY (l.type = 'warehouse') DESC, l.name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/locations', requireRole('admin', 'office'), async (req, res) => {
  const { name, type = 'van', user_ids = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [loc] } = await client.query(
      'INSERT INTO stock_locations (name, type) VALUES ($1,$2) RETURNING id',
      [name.trim(), type === 'warehouse' ? 'warehouse' : 'van']
    );
    for (const uid of user_ids) {
      await client.query(
        'INSERT INTO stock_location_users (location_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [loc.id, uid]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ id: loc.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

router.put('/locations/:id', requireRole('admin', 'office'), async (req, res) => {
  const { name, user_ids, is_active } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE stock_locations
       SET name = COALESCE($1, name), is_active = COALESCE($2, is_active)
       WHERE id = $3`,
      [name?.trim() || null, typeof is_active === 'boolean' ? is_active : null, req.params.id]
    );
    if (Array.isArray(user_ids)) {
      await client.query('DELETE FROM stock_location_users WHERE location_id = $1', [req.params.id]);
      for (const uid of user_ids) {
        await client.query(
          'INSERT INTO stock_location_users (location_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [req.params.id, uid]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ message: 'Saved' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── Stock report ─────────────────────────────────────────────────────────────

// Every product that is either stocked somewhere or has a barcode, with its
// quantity at each location. Products never stocked and never barcoded are left
// out so the report is about stock rather than the whole price list.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      // The description as well as the name: a stock list of DCT4276 and
      // SV04L+ is unreadable to anyone who did not order them, and the name is
      // often just the supplier's code.
      `SELECT p.id, p.name, p.category, p.unit, p.unit_price, p.cost_price, p.stock_kind,
              p.description,
              COALESCE((
                SELECT json_agg(json_build_object('location_id', s.location_id, 'quantity', s.quantity))
                FROM stock_levels s WHERE s.product_id = p.id AND s.quantity <> 0
              ), '[]'::json) AS levels,
              COALESCE((
                SELECT json_agg(json_build_object('code', b.code, 'source', b.source) ORDER BY b.created_at)
                FROM product_barcodes b WHERE b.product_id = p.id
              ), '[]'::json) AS barcodes,
              COALESCE((SELECT SUM(s.quantity) FROM stock_levels s WHERE s.product_id = p.id), 0) AS total_quantity
       FROM products p
       WHERE p.is_active
         AND (EXISTS (SELECT 1 FROM stock_levels s WHERE s.product_id = p.id AND s.quantity <> 0)
              OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id))
       ORDER BY p.category NULLS LAST, p.name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// What should be sitting in one location — the van sheet a tech checks against
// before leaving, or the warehouse shelf list.
router.get('/locations/:id/stock', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.category, p.unit, p.cost_price, p.stock_kind,
              s.quantity,
              (s.quantity * p.cost_price) AS value_cents
       FROM stock_levels s
       JOIN products p ON p.id = s.product_id
       WHERE s.location_id = $1 AND s.quantity <> 0
       ORDER BY p.category NULLS LAST, p.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// What the stock is worth, by location.
//
// Valued at cost — what we paid — since that is what the stock represents as an
// asset. Valuing it at sell price would inflate the figure by the margin. A
// product with no cost price entered contributes nothing, so the count of those
// comes back too rather than letting the total look more complete than it is.
router.get('/valuation', requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      // Materials and tools are both held here and both worth money, but they
      // are not one number: "the van holds $900 of stock" and "the van holds
      // $4,200 of tools" answer different questions, and a total that mixes
      // them answers neither.
      `SELECT l.id, l.name, l.type,
              COALESCE(SUM(s.quantity * p.cost_price), 0)::bigint AS value_cents,
              COALESCE(SUM(s.quantity), 0) AS unit_count,
              COALESCE(SUM(s.quantity * p.cost_price)
                FILTER (WHERE p.stock_kind = 'tool'), 0)::bigint AS tool_value_cents,
              COALESCE(SUM(s.quantity) FILTER (WHERE p.stock_kind = 'tool'), 0) AS tool_count,
              COALESCE(SUM(s.quantity * p.cost_price)
                FILTER (WHERE p.stock_kind <> 'tool'), 0)::bigint AS material_value_cents,
              COUNT(DISTINCT p.id) FILTER (WHERE COALESCE(p.cost_price, 0) = 0) AS missing_cost_count
       FROM stock_locations l
       LEFT JOIN stock_levels s ON s.location_id = l.id AND s.quantity <> 0
       LEFT JOIN products p ON p.id = s.product_id
       WHERE l.is_active
       GROUP BY l.id, l.name, l.type
       ORDER BY (l.type = 'warehouse') DESC, l.name`
    );
    const sum = (field) => rows.reduce((t, r) => t + Number(r[field] || 0), 0);
    res.json({
      locations: rows,
      total_value_cents: sum('value_cents'),
      total_tool_value_cents: sum('tool_value_cents'),
      total_material_value_cents: sum('material_value_cents'),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/movements', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, p.name AS product_name, u.name AS user_name,
              f.name AS from_name, t.name AS to_name,
              j.job_number, j.external_ref
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN stock_locations f ON f.id = m.from_location_id
       LEFT JOIN stock_locations t ON t.id = m.to_location_id
       LEFT JOIN jobs j ON j.id = m.job_id
       ORDER BY m.created_at DESC
       LIMIT 200`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Barcodes ─────────────────────────────────────────────────────────────────

// Resolve a scanned code. A 404 here is the normal "we haven't seen this box
// before" case, which the scanner turns into an offer to assign it.
// A UPC-A and the EAN-13 with a zero in front of it are the same barcode, and
// which one comes back depends on the phone that read it. A 14-digit carton
// code is the same product in an outer box. All of them have to find the
// product, or the same item reads as a different one depending on who is
// holding it — and ends up on the price list twice.
function codeVariants(code) {
  const s = String(code || '').trim();
  const out = [s];
  if (/^\d+$/.test(s)) {
    if (s.length === 12) out.push(`0${s}`);
    if ((s.length === 13 || s.length === 14) && s.startsWith('0')) out.push(s.replace(/^0+/, '').padStart(12, '0'));
    if (s.length === 13 && s.startsWith('0')) out.push(s.slice(1));
    if (s.length === 14 && s.startsWith('0')) out.push(s.slice(1));
  }
  return [...new Set(out.filter(Boolean))];
}

// Every barcode we know, for the scanner to hold while it is open.
//
// This is what makes scanning reliable. A phone reading bars off a creased
// bag in daylight produces wrong answers that are internally consistent —
// right length, right check digit, nothing to tell them apart from a real
// one. What a misread never does is match a code we already hold: there are a
// few hundred of those and ten trillion thirteen-digit numbers.
//
// So the scanner keeps looking until it sees one it recognises, the way a
// supermarket till does, and the wrong reads go by unnoticed. Small enough to
// send in one go and re-fetch whenever the scanner opens.
router.get('/barcodes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.code, b.product_id, p.name, p.unit
         FROM product_barcodes b JOIN products p ON p.id = b.product_id
        WHERE p.is_active
        ORDER BY b.code`
    );
    res.json(rows);
  } catch (err) {
    console.error('[stock] barcodes failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/lookup', async (req, res) => {
  const code = (req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'code required' });
  try {
    const tried = codeVariants(code);
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.unit, p.unit_price, p.cost_price, b.code, b.source
       FROM product_barcodes b JOIN products p ON p.id = b.product_id
       WHERE b.code = ANY($1::text[])
       -- The code exactly as scanned wins over the same thing written the
       -- other way round.
       ORDER BY (b.code = $2) DESC
       LIMIT 1`,
      [tried, code]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unknown barcode', code });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// A barcode saved against the wrong product is permanent: every scan of that
// box afterwards finds the wrong thing, and nobody thinks to doubt it. So an
// all-digit code claiming to be a retail barcode has to be a length one
// actually is, and has to pass its check digit — which catches most of what a
// camera invents. Our own labels are DEK###### and go through untouched.
function retailCodeProblem(code) {
  const s = String(code || '').trim();
  if (!/^\d+$/.test(s)) return null;
  if (![8, 12, 13, 14].includes(s.length)) {
    return `${s} is ${s.length} digits — a product barcode is 8, 12, 13 or 14. `
      + 'That usually means the camera only read part of it. Try scanning again.';
  }
  const want = Number(s[s.length - 1]);
  let sum = 0;
  for (let i = s.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(s[i]) * w;
  if ((10 - (sum % 10)) % 10 !== want) {
    return `${s} is not a valid barcode — its check digit does not match, so it was `
      + 'misread. Try scanning again.';
  }
  return null;
}

router.post('/barcodes', async (req, res) => {
  const { product_id, code, source = 'supplier' } = req.body;
  if (!product_id || !code?.trim()) return res.status(400).json({ error: 'product_id and code are required' });
  const problem = source !== 'internal' ? retailCodeProblem(code) : null;
  if (problem) return res.status(400).json({ error: problem });
  try {
    const { rows } = await pool.query(
      `INSERT INTO product_barcodes (product_id, code, source, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [product_id, code.trim(), source === 'internal' ? 'internal' : 'supplier', req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That barcode is already assigned to another product' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete('/barcodes/:code', requireRole('admin', 'office'), async (req, res) => {
  try {
    await pool.query('DELETE FROM product_barcodes WHERE code = $1', [req.params.code]);
    res.json({ message: 'Removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mints one of our own label codes for a product that has no maker barcode.
// DEK- prefixed so an internal label is recognisable at a glance, and the
// random tail keeps it from colliding with anything scanned off a box.
router.post('/barcodes/generate', requireRole('admin', 'office'), async (req, res) => {
  const { product_id } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id required' });
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = 'DEK' + Math.floor(100000 + Math.random() * 900000);
      try {
        const { rows } = await pool.query(
          `INSERT INTO product_barcodes (product_id, code, source, created_by)
           VALUES ($1,$2,'internal',$3) RETURNING *`,
          [product_id, code, req.user.id]
        );
        return res.status(201).json(rows[0]);
      } catch (err) {
        if (err.code !== '23505') throw err; // collision — try another
      }
    }
    res.status(500).json({ error: 'Could not allocate a code, please try again' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Movements ────────────────────────────────────────────────────────────────

// Goods arriving: straight into a location, no source.
router.post('/receive', async (req, res) => {
  const { product_id, location_id, quantity = 1 } = req.body;
  if (!product_id || !location_id) return res.status(400).json({ error: 'product_id and location_id are required' });
  const qty = Number(quantity);
  if (!(qty > 0)) return res.status(400).json({ error: 'Quantity must be greater than zero' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await moveStock(client, {
      productId: product_id, fromId: null, toId: location_id,
      quantity: qty, reason: 'receive', userId: req.user.id,
    });
    await client.query('COMMIT');
    res.status(201).json({ message: 'Received' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// Warehouse to van (or van to van).
router.post('/transfer', async (req, res) => {
  const { product_id, from_location_id, to_location_id, quantity = 1 } = req.body;
  if (!product_id || !from_location_id || !to_location_id) {
    return res.status(400).json({ error: 'product_id, from_location_id and to_location_id are required' });
  }
  if (from_location_id === to_location_id) {
    return res.status(400).json({ error: 'Pick two different locations' });
  }
  const qty = Number(quantity);
  if (!(qty > 0)) return res.status(400).json({ error: 'Quantity must be greater than zero' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await moveStock(client, {
      productId: product_id, fromId: from_location_id, toId: to_location_id,
      quantity: qty, reason: 'transfer', userId: req.user.id,
    });
    await client.query('COMMIT');
    res.status(201).json({ message: 'Transferred' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// Material charged to a job that never went on it, put back where it is.
//
// The job was charged for what the invoice said, which is what was bought, not
// what was fitted. The leftovers are in a van or back at the warehouse and in
// nobody's count. This is the one movement that changes what a job cost, so it
// is careful about three things:
//
//   it cannot return more than the line was charged for, however many times it
//     is pressed;
//   the cost comes off the job only for what went back, so a partly used line
//     still costs the job what it used;
//   and a line already invoiced to the customer is refused, because the money
//     has been asked for and taking the cost off now would not unask it.
//
// The line's own quantity comes down by what went back, and what went back is
// recorded beside it. Seven different places add up a job's costs, and taking
// the return off the quantity means every one of them is right without being
// touched — the alternative was teaching each of them to subtract, which is
// how one of them ends up still charging for timber that is in the van.
// Together the two columns still say what the invoice said.
router.post('/return-from-job', async (req, res) => {
  const { cost_id, to_location_id, quantity, create_product } = req.body || {};
  if (!cost_id || !to_location_id) {
    return res.status(400).json({ error: 'cost_id and to_location_id are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Locked, so two people returning the same line cannot each be told there
    // was enough left.
    const { rows: [cost] } = await client.query(
      `SELECT c.id, c.job_id, c.description, c.sku, c.quantity, c.unit_price,
              c.returned_quantity, c.billed_at, s.supplier
         FROM job_costs c
         LEFT JOIN job_cost_scans s ON s.id = c.scan_id
        WHERE c.id = $1
        FOR UPDATE OF c`,
      [cost_id]
    );
    if (!cost) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That cost line no longer exists' });
    }
    if (cost.billed_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'That line has already been invoiced to the customer. Credit the invoice first.',
      });
    }

    // What the job is still being charged for, which is all that can go back.
    const already = Number(cost.returned_quantity) || 0;
    const left = Number(cost.quantity);
    const qty = quantity === undefined ? left : Number(quantity);
    if (!(qty > 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quantity must be greater than zero' });
    }
    if (qty > left + 1e-9) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: already > 0
          ? `Only ${left} of that line is still charged to the job — ${already} has already gone back.`
          : `That line is only for ${cost.quantity}.`,
      });
    }

    const { rows: [location] } = await client.query(
      'SELECT id, name FROM stock_locations WHERE id = $1 AND is_active', [to_location_id]);
    if (!location) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That stock location does not exist' });
    }

    // Which product this line is. A cost line is text off an invoice, so it is
    // matched the way the price list matches an invoice: the supplier's code
    // first, then the name.
    let { product } = await productMatch.matchProduct(
      { sku: cost.sku, name: cost.description, supplier: cost.supplier }, client);

    if (!product && create_product) {
      // Putting something in stock that is not on the price list yet. Its cost
      // is what this invoice charged, which is the best figure there is.
      const { rows: [made] } = await client.query(
        `INSERT INTO products (name, sku, supplier, unit, cost_price, unit_price, is_active)
         VALUES ($1,$2,$3,'each',$4,$4,true) RETURNING *`,
        [cost.description, productMatch.usableSku(cost.sku) ? cost.sku : null,
         cost.supplier || null, cost.unit_price]
      );
      product = made;
    }
    if (!product) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `"${cost.description}" is not on the price list, so there is nowhere to put it. `
          + 'Add it to the price list, or send it back with "add to the price list" ticked.',
        needs_product: true,
        description: cost.description,
      });
    }

    await moveStock(client, {
      productId: product.id, fromId: null, toId: to_location_id,
      quantity: qty, reason: 'returned_from_job', jobId: cost.job_id, userId: req.user.id,
    });

    await client.query(
      `UPDATE job_costs
          SET quantity = quantity - $1::numeric,
              returned_quantity = returned_quantity + $1::numeric
        WHERE id = $2`,
      [qty, cost_id]
    );

    await client.query('COMMIT');
    res.status(201).json({
      returned: qty,
      remaining: left - qty,
      product: { id: product.id, name: product.name },
      location: location.name,
      value_cents: Math.round(qty * Number(cost.unit_price)),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[stock] return from job failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// Fitted on site: comes off the van and lands on the job as a cost.
//
// The cost recorded is what we paid (cost_price), not the sell price — this is
// the Costs tab, which is what the job cost us. Falls back to unit_price where
// no cost price has been entered, so a product without one still books a value
// rather than silently costing nothing.
router.post('/use', async (req, res) => {
  const { product_id, from_location_id, job_id, quantity = 1 } = req.body;
  if (!product_id || !from_location_id || !job_id) {
    return res.status(400).json({ error: 'product_id, from_location_id and job_id are required' });
  }
  const qty = Number(quantity);
  if (!(qty > 0)) return res.status(400).json({ error: 'Quantity must be greater than zero' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [product] } = await client.query(
      'SELECT id, name, unit_price, cost_price FROM products WHERE id = $1', [product_id]
    );
    if (!product) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found' }); }

    const { rows: [job] } = await client.query('SELECT id FROM jobs WHERE id = $1', [job_id]);
    if (!job) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Job not found' }); }

    await moveStock(client, {
      productId: product_id, fromId: from_location_id, toId: null,
      quantity: qty, reason: 'used_on_job', jobId: job_id, userId: req.user.id,
    });

    const unitPrice = product.cost_price || product.unit_price || 0;
    const { rows: [cost] } = await client.query(
      `INSERT INTO job_costs (job_id, description, quantity, unit_price, sort_order)
       VALUES ($1,$2,$3,$4, COALESCE((SELECT MAX(sort_order) + 1 FROM job_costs WHERE job_id = $1), 0))
       RETURNING *`,
      [job_id, product.name, qty, unitPrice]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Added to job costs', cost, product });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// Stocktake correction — sets the figure outright rather than nudging it, and
// records the difference so the count still reconciles against the audit trail.
//
// Admin only. Every other route here moves stock by scanning something real;
// this is the one that can write a number with nothing behind it, so it is the
// one that needs holding tightly.
router.post('/adjust', requireRole('admin'), async (req, res) => {
  const { product_id, location_id, quantity } = req.body;
  if (!product_id || !location_id || quantity == null) {
    return res.status(400).json({ error: 'product_id, location_id and quantity are required' });
  }
  const target = Number(quantity);
  if (Number.isNaN(target)) return res.status(400).json({ error: 'Quantity must be a number' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [current] } = await client.query(
      'SELECT quantity FROM stock_levels WHERE location_id = $1 AND product_id = $2',
      [location_id, product_id]
    );
    const delta = target - Number(current?.quantity || 0);
    await client.query(
      `INSERT INTO stock_levels (location_id, product_id, quantity, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (location_id, product_id)
       DO UPDATE SET quantity = $3, updated_at = NOW()`,
      [location_id, product_id, target]
    );
    if (delta !== 0) {
      await client.query(
        `INSERT INTO stock_movements (product_id, to_location_id, quantity, reason, user_id)
         VALUES ($1,$2,$3,'adjust',$4)`,
        [product_id, location_id, delta, req.user.id]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Adjusted', quantity: target });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;
