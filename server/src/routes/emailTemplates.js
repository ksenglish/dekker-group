const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const CATEGORIES = ['quote', 'invoice', 'job'];

router.use(authenticate);

router.get('/', async (req, res) => {
  const { category } = req.query;
  try {
    const { rows } = category
      ? await pool.query('SELECT * FROM email_templates WHERE category=$1 ORDER BY is_default DESC, name', [category])
      : await pool.query('SELECT * FROM email_templates ORDER BY category, is_default DESC, name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', requireRole('admin', 'office'), async (req, res) => {
  const { category, name, subject, body, is_default } = req.body;
  if (!name?.trim() || !subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Name, subject and body are required' });
  }
  if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_default) {
      await client.query('UPDATE email_templates SET is_default=false WHERE category=$1', [category || 'quote']);
    }
    const { rows } = await client.query(
      `INSERT INTO email_templates (category, name, subject, body, is_default)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [category || 'quote', name.trim(), subject.trim(), body, !!is_default]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

router.put('/:id', requireRole('admin', 'office'), async (req, res) => {
  const { name, subject, body, is_default } = req.body;
  if (!name?.trim() || !subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Name, subject and body are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query('SELECT category FROM email_templates WHERE id=$1', [req.params.id]);
    if (!existing[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Template not found' }); }
    if (is_default) {
      await client.query('UPDATE email_templates SET is_default=false WHERE category=$1', [existing[0].category]);
    }
    const { rows } = await client.query(
      `UPDATE email_templates SET name=$1, subject=$2, body=$3, is_default=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [name.trim(), subject.trim(), body, !!is_default, req.params.id]
    );
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

router.delete('/:id', requireRole('admin', 'office'), async (req, res) => {
  try {
    await pool.query('DELETE FROM email_templates WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
