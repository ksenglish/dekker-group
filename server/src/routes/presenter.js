const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

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
  const { name, image_base64, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO presenter_subcategories (section_id, name, image_base64, sort_order, parent_id)
       VALUES ($1,$2,$3,$4,NULL) RETURNING *`,
      [req.params.id, name, image_base64 || null, sort_order || 0]
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

router.put('/subcategories/:id', requireRole('admin', 'office'), async (req, res) => {
  const { name, image_base64, sort_order } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE presenter_subcategories SET name=$1,image_base64=$2,sort_order=$3 WHERE id=$4 RETURNING *`,
      [name, image_base64 !== undefined ? image_base64 : null, sort_order || 0, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/subcategories/:id', requireRole('admin', 'office'), async (req, res) => {
  try {
    await pool.query('DELETE FROM presenter_subcategories WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Products ──────────────────────────────────────────────────────────────────
router.get('/sections/:id/products', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM presenter_products WHERE section_id=$1 ORDER BY sort_order, name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/subcategories/:id/products', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM presenter_products WHERE subcategory_id=$1 ORDER BY sort_order, name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sections/:id/products', requireRole('admin', 'office'), async (req, res) => {
  const { name, description, image_base64, price_from, features, calculator_type, calculator_config, sort_order, subcategory_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO presenter_products
         (section_id, subcategory_id, name, description, image_base64, price_from, features, calculator_type, calculator_config, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, subcategory_id || null, name, description || null, image_base64 || null,
       price_from ? Math.round(price_from * 100) : 0,
       features || [], calculator_type || 'unit',
       calculator_config ? JSON.stringify(calculator_config) : '{}',
       sort_order || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/subcategories/:id/products', requireRole('admin', 'office'), async (req, res) => {
  const { name, description, image_base64, price_from, features, calculator_type, calculator_config, sort_order, section_id } = req.body;
  if (!name || !section_id) return res.status(400).json({ error: 'Name and section_id are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO presenter_products
         (section_id, subcategory_id, name, description, image_base64, price_from, features, calculator_type, calculator_config, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [section_id, req.params.id, name, description || null, image_base64 || null,
       price_from ? Math.round(price_from * 100) : 0,
       features || [], calculator_type || 'unit',
       calculator_config ? JSON.stringify(calculator_config) : '{}',
       sort_order || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/products/:id', requireRole('admin', 'office'), async (req, res) => {
  const { name, description, image_base64, price_from, features, calculator_type, calculator_config, sort_order, subcategory_id } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE presenter_products SET name=$1,description=$2,image_base64=$3,price_from=$4,
       features=$5,calculator_type=$6,calculator_config=$7,sort_order=$8,subcategory_id=$9 WHERE id=$10 RETURNING *`,
      [name, description || null, image_base64 || null,
       price_from ? Math.round(price_from * 100) : 0,
       features || [], calculator_type || 'unit',
       calculator_config ? JSON.stringify(calculator_config) : '{}',
       sort_order || 0, subcategory_id || null, req.params.id]
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
