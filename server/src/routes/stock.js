const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

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
      `SELECT p.id, p.name, p.category, p.unit, p.unit_price, p.cost_price,
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
router.get('/lookup', async (req, res) => {
  const code = (req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'code required' });
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.unit, p.unit_price, p.cost_price, b.code, b.source
       FROM product_barcodes b JOIN products p ON p.id = b.product_id
       WHERE b.code = $1`,
      [code]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unknown barcode', code });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/barcodes', async (req, res) => {
  const { product_id, code, source = 'supplier' } = req.body;
  if (!product_id || !code?.trim()) return res.status(400).json({ error: 'product_id and code are required' });
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
router.post('/adjust', requireRole('admin', 'office'), async (req, res) => {
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
