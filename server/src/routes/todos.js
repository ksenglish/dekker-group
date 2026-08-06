const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

const SELECT = `
  SELECT t.*,
         a.name AS assigned_to_name,
         cb.name AS created_by_name,
         j.job_number, j.external_ref
  FROM todos t
  LEFT JOIN users a  ON a.id = t.assigned_to
  LEFT JOIN users cb ON cb.id = t.created_by
  LEFT JOIN jobs  j  ON j.id = t.job_id
`;

// A to-do is private to the person it's assigned to and the person who raised
// it — nobody else sees it, including admins.
const visible = n => `(t.assigned_to = $${n} OR t.created_by = $${n})`;

// Count of open items that have hit their due date — drives the sidebar badge
router.get('/due-count', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM todos t
       WHERE t.done = FALSE
         AND t.due_date IS NOT NULL AND t.due_date <= CURRENT_DATE
         AND ${visible(1)}`,
      [req.user.id]
    );
    res.json({ count: row.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ?done=true returns completed items; default is the open list
router.get('/', async (req, res) => {
  const done = req.query.done === 'true';
  // Open list: soonest due date first, undated reminders last.
  // Done list: most recently completed first.
  const order = done
    ? 'ORDER BY t.done_at DESC NULLS LAST, t.created_at DESC'
    : 'ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC';
  try {
    const { rows } = await pool.query(
      `${SELECT} WHERE ${visible(1)} AND t.done = $2 ${order}`,
      [req.user.id, done]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { description, notes, due_date, assigned_to, job_id } = req.body;
  if (!description || !description.trim()) return res.status(400).json({ error: 'description required' });
  if (!assigned_to) return res.status(400).json({ error: 'assigned_to required' });
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO todos (description, notes, due_date, assigned_to, job_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [description.trim(), notes || null, due_date || null, assigned_to, job_id || null, req.user.id]
    );
    const { rows } = await pool.query(`${SELECT} WHERE t.id = $1`, [row.id]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  const { description, notes, due_date, assigned_to, job_id } = req.body;
  if (!assigned_to) return res.status(400).json({ error: 'assigned_to required' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE todos t
       SET description = COALESCE($1, t.description),
           notes = $2, due_date = $3, assigned_to = $4, job_id = $5,
           updated_at = NOW()
       WHERE t.id = $6 AND ${visible(7)}`,
      [description?.trim() || null, notes || null, due_date || null,
       assigned_to, job_id || null, req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(`${SELECT} WHERE t.id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Tick / untick
router.patch('/:id/done', async (req, res) => {
  const done = req.body.done !== false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE todos t
       SET done = $1,
           done_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
           done_by = CASE WHEN $1 THEN $2::uuid ELSE NULL END,
           updated_at = NOW()
       WHERE t.id = $3 AND ${visible(2)}`,
      [done, req.user.id, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(`${SELECT} WHERE t.id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM todos t WHERE t.id = $1 AND ${visible(2)}`,
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
