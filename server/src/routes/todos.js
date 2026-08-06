const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// The server runs in UTC but the business runs in NZ, so "today" has to be the
// NZ date — otherwise an item due today doesn't badge until UTC catches up,
// which reads as the badge arriving a day late.
const NZ_TODAY = `(NOW() AT TIME ZONE 'Pacific/Auckland')::date`;

// A to-do is private to the people it's assigned to and the person who raised
// it — nobody else sees it, including admins.
const visible = n => `(t.created_by = $${n} OR EXISTS (
  SELECT 1 FROM todo_assignees ta WHERE ta.todo_id = t.id AND ta.user_id = $${n}
))`;

const SELECT = `
  SELECT t.*,
         cb.name AS created_by_name,
         j.job_number, j.external_ref,
         COALESCE((
           SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
           FROM todo_assignees ta JOIN users u ON u.id = ta.user_id
           WHERE ta.todo_id = t.id
         ), '[]'::json) AS assignees
  FROM todos t
  LEFT JOIN users cb ON cb.id = t.created_by
  LEFT JOIN jobs  j  ON j.id = t.job_id
`;

async function replaceAssignees(client, todoId, userIds) {
  await client.query('DELETE FROM todo_assignees WHERE todo_id = $1', [todoId]);
  const unique = [...new Set(userIds)];
  for (const uid of unique) {
    await client.query(
      'INSERT INTO todo_assignees (todo_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [todoId, uid]
    );
  }
}

// Accepts either the new assignee_ids array or a single assigned_to
function readAssignees(body) {
  if (Array.isArray(body.assignee_ids)) return body.assignee_ids.filter(Boolean);
  return body.assigned_to ? [body.assigned_to] : [];
}

// Count of open items whose due date has arrived — drives the sidebar badge
router.get('/due-count', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM todos t
       WHERE t.done = FALSE
         AND t.due_date IS NOT NULL AND t.due_date <= ${NZ_TODAY}
         AND ${visible(1)}`,
      [req.user.id]
    );
    res.json({ count: row.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
  const { description, notes, due_date, job_id } = req.body;
  const assignees = readAssignees(req.body);
  if (!description || !description.trim()) return res.status(400).json({ error: 'description required' });
  if (assignees.length === 0) return res.status(400).json({ error: 'at least one assignee required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [row] } = await client.query(
      `INSERT INTO todos (description, notes, due_date, job_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [description.trim(), notes || null, due_date || null, job_id || null, req.user.id]
    );
    await replaceAssignees(client, row.id, assignees);
    await client.query('COMMIT');

    const { rows } = await pool.query(`${SELECT} WHERE t.id = $1`, [row.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

router.put('/:id', async (req, res) => {
  const { description, notes, due_date, job_id } = req.body;
  const assignees = readAssignees(req.body);
  if (assignees.length === 0) return res.status(400).json({ error: 'at least one assignee required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE todos t
       SET description = COALESCE($1, t.description),
           notes = $2, due_date = $3, job_id = $4,
           updated_at = NOW()
       WHERE t.id = $5 AND ${visible(6)}`,
      [description?.trim() || null, notes || null, due_date || null,
       job_id || null, req.params.id, req.user.id]
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await replaceAssignees(client, req.params.id, assignees);
    await client.query('COMMIT');

    const { rows } = await pool.query(`${SELECT} WHERE t.id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// Tick / untick — completing a shared to-do completes it for everyone on it
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
