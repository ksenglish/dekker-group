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
  const { name, color, icon, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO presenter_sections (name, color, icon, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, color || '#1e40af', icon || '🏠', sort_order || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sections/:id', requireRole('admin', 'office'), async (req, res) => {
  const { name, color, icon, sort_order } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE presenter_sections SET name=$1,color=$2,icon=$3,sort_order=$4 WHERE id=$5 RETURNING *`,
      [name, color, icon, sort_order, req.params.id]
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

router.post('/sections/:id/products', requireRole('admin', 'office'), async (req, res) => {
  const { name, description, image_base64, price_from, features, calculator_type, calculator_config, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO presenter_products
         (section_id, name, description, image_base64, price_from, features, calculator_type, calculator_config, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, name, description || null, image_base64 || null,
       price_from ? Math.round(price_from * 100) : 0,
       features || [], calculator_type || 'area',
       calculator_config ? JSON.stringify(calculator_config) : '{}',
       sort_order || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/products/:id', requireRole('admin', 'office'), async (req, res) => {
  const { name, description, image_base64, price_from, features, calculator_type, calculator_config, sort_order } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE presenter_products SET name=$1,description=$2,image_base64=$3,price_from=$4,
       features=$5,calculator_type=$6,calculator_config=$7,sort_order=$8 WHERE id=$9 RETURNING *`,
      [name, description || null, image_base64 || null,
       price_from ? Math.round(price_from * 100) : 0,
       features || [], calculator_type || 'area',
       calculator_config ? JSON.stringify(calculator_config) : '{}',
       sort_order || 0, req.params.id]
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
