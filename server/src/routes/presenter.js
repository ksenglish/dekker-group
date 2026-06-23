const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

// Merge price-list product fields into presenter product row
function enrichProduct(r) {
  const { pl_id, pl_name, pl_unit_price, pl_description, ...rest } = r;
  return {
    ...rest,
    price_list_product: pl_id ? { id: pl_id, name: pl_name, unit_price: pl_unit_price, description: pl_description } : null,
  };
}

// ── Sections ──────────────────────────────────────────────────────────────────
router.get('/sections', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, COUNT(p.id)::int AS product_count
       FROM presenter_sections s
       LEFT JOIN presenter_products p ON p.section_id = s.id
       GROUP BY s.id ORDER BY s.sort_order, s.name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sections', requireRole('admin', 'office'), async (req, res) => {
  const { name, color, icon, sort_order, image_base64 } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO presenter_sections (name, color, icon, sort_order, image_base64) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, color || '#1e40af', icon || '🏠', sort_order || 0, image_base64 || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sections/:id', requireRole('admin', 'office'), async (req, res) => {
  const { name, color, icon, sort_order, image_base64 } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE presenter_sections SET name=$1,color=$2,icon=$3,sort_order=$4,image_base64=$5 WHERE id=$6 RETURNING *`,
      [name, color, icon, sort_order, image_base64 !== undefined ? image_base64 : null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/sections/reorder', requireRole('admin', 'office'), async (req, res) => {
  const items = req.body; // [{ id, sort_order }]
  try {
    await Promise.all(items.map(({ id, sort_order }) =>
      pool.query('UPDATE presenter_sections SET sort_order=$1 WHERE id=$2', [sort_order, id])
    ));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/sections/:id', requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM presenter_sections WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Subcategories ─────────────────────────────────────────────────────────────
router.get('/sections/:id/subcategories', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*,
         COUNT(DISTINCT p.id)::int AS product_count,
         COUNT(DISTINCT c.id)::int AS child_count
       FROM presenter_subcategories s
       LEFT JOIN presenter_products p ON p.subcategory_id = s.id
       LEFT JOIN presenter_subcategories c ON c.parent_id = s.id
       WHERE s.section_id=$1 AND s.parent_id IS NULL
       GROUP BY s.id ORDER BY s.sort_order, s.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/subcategories/:id/subcategories', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*,
         COUNT(DISTINCT p.id)::int AS product_count,
         COUNT(DISTINCT c.id)::int AS child_count
       FROM presenter_subcategories s
       LEFT JOIN presenter_products p ON p.subcategory_id = s.id
       LEFT JOIN presenter_subcategories c ON c.parent_id = s.id
       WHERE s.parent_id=$1
       GROUP BY s.id ORDER BY s.sort_order, s.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sections/:id/subcategories', requireRole('admin', 'office'), async (req, res) => {
  const { name, image_base64, sort_order, hide_label } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO presenter_subcategories (section_id, name, image_base64, sort_order, parent_id, hide_label)
       VALUES ($1,$2,$3,$4,NULL,$5) RETURNING *`,
      [req.params.id, name, image_base64 || null, sort_order || 0, hide_label || false]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create child subcategory under another subcategory
router.post('/subcategories/:id/subcategories', requireRole('admin', 'office'), async (req, res) => {
  const { name, image_base64, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    // Inherit section_id from parent
    const { rows: [parent] } = await pool.query('SELECT section_id FROM presenter_subcategories WHERE id=$1', [req.params.id]);
    if (!parent) return res.status(404).json({ error: 'Parent subcategory not found' });
    const { rows } = await pool.query(
      `INSERT INTO presenter_subcategories (section_id, parent_id, name, image_base64, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [parent.section_id, req.params.id, name, image_base64 || null, sort_order || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Move subcategory to a new parent (or to section root if parent_id is null)
router.patch('/subcategories/:id/parent', requireRole('admin', 'office'), async (req, res) => {
  const { parent_id } = req.body; // null = move to section root
  try {
    // Get this subcategory's section_id
    const { rows: [sc] } = await pool.query('SELECT section_id FROM presenter_subcategories WHERE id=$1', [req.params.id]);
    if (!sc) return res.status(404).json({ error: 'Not found' });
    // Prevent circular reference: ensure new parent is not a descendant
    if (parent_id) {
      // Walk up from parent_id to make sure we don't hit req.params.id
      let check = parent_id;
      while (check) {
        if (check === req.params.id) return res.status(400).json({ error: 'Cannot move a category into its own descendant' });
        const { rows: [p] } = await pool.query('SELECT parent_id FROM presenter_subcategories WHERE id=$1', [check]);
        check = p?.parent_id || null;
      }
    }
    const { rows } = await pool.query(
      `UPDATE presenter_subcategories SET parent_id=$1 WHERE id=$2 RETURNING *`,
      [parent_id || null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/subcategories/:id', requireRole('admin', 'office'), async (req, res) => {
  const { name, image_base64, sort_order, hide_label } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE presenter_subcategories SET name=$1,image_base64=$2,sort_order=$3,hide_label=$4 WHERE id=$5 RETURNING *`,
      [name, image_base64 !== undefined ? image_base64 : null, sort_order || 0, hide_label || false, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/subcategories/reorder', requireRole('admin', 'office'), async (req, res) => {
  const items = req.body; // [{ id, sort_order }]
  try {
    await Promise.all(items.map(({ id, sort_order }) =>
      pool.query('UPDATE presenter_subcategories SET sort_order=$1 WHERE id=$2', [sort_order, id])
    ));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/subcategories/:id', requireRole('admin', 'office'), async (req, res) => {
  try {
    await pool.query('DELETE FROM presenter_subcategories WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Products ──────────────────────────────────────────────────────────────────
// List queries: omit large binary fields (brochures, price-list media) — loaded on demand via /products/:id
router.get('/sections/:id/products', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pp.id, pp.section_id, pp.subcategory_id, pp.name, pp.description,
              pp.image_base64, pp.price_from, pp.features, pp.calculator_type,
              pp.calculator_config, pp.sort_order, pp.price_list_product_id,
         pl.id AS pl_id, pl.name AS pl_name, pl.unit_price AS pl_unit_price,
         pl.description AS pl_description
       FROM presenter_products pp
       LEFT JOIN products pl ON pl.id = pp.price_list_product_id
       WHERE pp.section_id=$1 ORDER BY pp.sort_order, pp.name`,
      [req.params.id]
    );
    res.json(rows.map(r => enrichProduct(r)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/subcategories/:id/products', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pp.id, pp.section_id, pp.subcategory_id, pp.name, pp.description,
              pp.image_base64, pp.price_from, pp.features, pp.calculator_type,
              pp.calculator_config, pp.sort_order, pp.price_list_product_id,
         pl.id AS pl_id, pl.name AS pl_name, pl.unit_price AS pl_unit_price,
         pl.description AS pl_description
       FROM presenter_products pp
       LEFT JOIN products pl ON pl.id = pp.price_list_product_id
       WHERE pp.subcategory_id=$1 ORDER BY pp.sort_order, pp.name`,
      [req.params.id]
    );
    res.json(rows.map(r => enrichProduct(r)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Single product — full data including images and brochures (loaded on demand)
router.get('/products/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pp.*,
         pl.id AS pl_id, pl.name AS pl_name, pl.unit_price AS pl_unit_price,
         pl.description AS pl_description, pl.media_base64 AS pl_image,
         pl.brochure_base64 AS pl_brochure
       FROM presenter_products pp
       LEFT JOIN products pl ON pl.id = pp.price_list_product_id
       WHERE pp.id=$1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const r = rows[0];
    const { pl_id, pl_name, pl_unit_price, pl_description, pl_image, pl_brochure, ...rest } = r;
    res.json({
      ...rest,
      brochure_base64: rest.brochure_base64 || pl_brochure || null,
      price_list_product: pl_id ? { id: pl_id, name: pl_name, unit_price: pl_unit_price, description: pl_description, image_base64: pl_image, brochure_base64: pl_brochure } : null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sections/:id/products', requireRole('admin', 'office'), async (req, res) => {
  const { name, description, image_base64, brochure_base64, price_from, features, calculator_type, calculator_config, sort_order, subcategory_id, price_list_product_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO presenter_products
         (section_id, subcategory_id, name, description, image_base64, brochure_base64, price_from, features, calculator_type, calculator_config, sort_order, price_list_product_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.params.id, subcategory_id || null, name, description || null, image_base64 || null, brochure_base64 || null,
       price_from ? Math.round(price_from * 100) : 0,
       features || [], calculator_type || 'unit',
       calculator_config ? JSON.stringify(calculator_config) : '{}',
       sort_order || 0, price_list_product_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/subcategories/:id/products', requireRole('admin', 'office'), async (req, res) => {
  const { name, description, image_base64, brochure_base64, price_from, features, calculator_type, calculator_config, sort_order, section_id, price_list_product_id } = req.body;
  if (!name || !section_id) return res.status(400).json({ error: 'Name and section_id are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO presenter_products
         (section_id, subcategory_id, name, description, image_base64, brochure_base64, price_from, features, calculator_type, calculator_config, sort_order, price_list_product_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [section_id, req.params.id, name, description || null, image_base64 || null, brochure_base64 || null,
       price_from ? Math.round(price_from * 100) : 0,
       features || [], calculator_type || 'unit',
       calculator_config ? JSON.stringify(calculator_config) : '{}',
       sort_order || 0, price_list_product_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/products/:id', requireRole('admin', 'office'), async (req, res) => {
  const { name, description, image_base64, brochure_base64, price_from, features, calculator_type, calculator_config, sort_order, subcategory_id, price_list_product_id } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE presenter_products SET name=$1,description=$2,image_base64=$3,brochure_base64=$4,price_from=$5,
       features=$6,calculator_type=$7,calculator_config=$8,sort_order=$9,subcategory_id=$10,price_list_product_id=$11 WHERE id=$12 RETURNING *`,
      [name, description || null, image_base64 || null, brochure_base64 !== undefined ? brochure_base64 : null,
       price_from ? Math.round(price_from * 100) : 0,
       features || [], calculator_type || 'unit',
       calculator_config ? JSON.stringify(calculator_config) : '{}',
       sort_order || 0, subcategory_id || null, price_list_product_id || null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/products/:id', requireRole('admin', 'office'), async (req, res) => {
  try {
    await pool.query('DELETE FROM presenter_products WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
