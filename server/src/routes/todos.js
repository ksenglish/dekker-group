const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { sendMail } = require('../utils/email');

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

// Adds and removes to reach the given set, rather than clearing and re-adding.
// A wholesale replace would reset seen_at for people who were already on the
// task, making an old to-do look new to them every time it's edited.
//
// Returns the ids that were genuinely newly assigned, which is who gets emailed.
async function replaceAssignees(client, todoId, userIds, { alreadySeenBy } = {}) {
  const unique = [...new Set(userIds)];

  if (unique.length === 0) {
    await client.query('DELETE FROM todo_assignees WHERE todo_id = $1', [todoId]);
    return [];
  }

  const { rows: before } = await client.query(
    'SELECT user_id FROM todo_assignees WHERE todo_id = $1', [todoId]
  );
  const had = new Set(before.map(r => r.user_id));

  await client.query(
    'DELETE FROM todo_assignees WHERE todo_id = $1 AND NOT (user_id = ANY($2::uuid[]))',
    [todoId, unique]
  );

  const added = [];
  for (const uid of unique) {
    if (had.has(uid)) continue;
    await client.query(
      `INSERT INTO todo_assignees (todo_id, user_id, seen_at)
       VALUES ($1, $2, CASE WHEN $2::uuid = $3::uuid THEN NOW() ELSE NULL END)
       ON CONFLICT DO NOTHING`,
      [todoId, uid, alreadySeenBy || null]
    );
    added.push(uid);
  }
  return added;
}

const appUrl = () => (process.env.CLIENT_URL || '').replace(/\/$/, '');

// Task text is typed by a person and goes straight into an HTML email, so it
// has to be escaped or a stray angle bracket breaks the message.
const escapeHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Notifications are best-effort. A task must still be created if the mail
// server is down or email was never configured, so failures are logged and
// swallowed rather than failing the request the user made.
async function notify(userIds, subject, bodyLines) {
  if (!userIds?.length) return;
  try {
    const { rows } = await pool.query(
      'SELECT name, email FROM users WHERE id = ANY($1::uuid[]) AND email IS NOT NULL',
      [userIds]
    );
    if (rows.length === 0) return;

    const link = appUrl() ? `${appUrl()}/todos` : null;
    const html = [
      ...bodyLines.map(l => `<p style="margin:0 0 12px">${l}</p>`),
      link ? `<p style="margin:16px 0 0"><a href="${link}">Open your To-Do List</a></p>` : '',
    ].join('');
    const text = bodyLines.join('\n\n') + (link ? `\n\n${link}` : '');

    for (const user of rows) {
      try {
        await sendMail({ to: user.email, subject, html, text });
      } catch (err) {
        console.error(`To-do notification to ${user.email} failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('To-do notification lookup failed:', err.message);
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

// Open tasks handed to this person that they haven't looked at yet. Their own
// tasks never count — you don't need telling about something you just wrote.
router.get('/unseen-count', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM todo_assignees ta
       JOIN todos t ON t.id = ta.todo_id
       WHERE ta.user_id = $1 AND ta.seen_at IS NULL AND t.done = FALSE`,
      [req.user.id]
    );
    res.json({ count: row.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Called when the list is opened — that is what "seen" means here.
router.post('/mark-seen', async (req, res) => {
  try {
    await pool.query(
      'UPDATE todo_assignees SET seen_at = NOW() WHERE user_id = $1 AND seen_at IS NULL',
      [req.user.id]
    );
    res.json({ message: 'Marked as seen' });
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
    const added = await replaceAssignees(client, row.id, assignees, { alreadySeenBy: req.user.id });
    await client.query('COMMIT');

    const { rows } = await pool.query(`${SELECT} WHERE t.id = $1`, [row.id]);
    res.status(201).json(rows[0]);

    // After responding — the person creating the task shouldn't wait on a mail
    // server, and a failed send must not fail the request.
    notify(
      added.filter(id => id !== req.user.id),
      `${req.user.name} assigned you a task`,
      [
        `<strong>${req.user.name}</strong> has assigned you a to-do:`,
        `<strong>${escapeHtml(description.trim())}</strong>`,
        ...(notes ? [escapeHtml(notes)] : []),
        ...(due_date ? [`Due ${new Date(due_date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}.`] : ['No due date — it is a reminder.']),
      ]
    );
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
    const added = await replaceAssignees(client, req.params.id, assignees, { alreadySeenBy: req.user.id });
    await client.query('COMMIT');

    const { rows } = await pool.query(`${SELECT} WHERE t.id = $1`, [req.params.id]);
    res.json(rows[0]);

    // Only people newly put on the task are told — everyone already on it has
    // had their email, and an edit shouldn't re-notify them.
    notify(
      added.filter(id => id !== req.user.id),
      `${req.user.name} assigned you a task`,
      [
        `<strong>${req.user.name}</strong> has assigned you a to-do:`,
        `<strong>${escapeHtml(rows[0]?.description || '')}</strong>`,
        ...(rows[0]?.notes ? [escapeHtml(rows[0].notes)] : []),
      ]
    );
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

    // Tell whoever raised it that it's been dealt with — but only when someone
    // else finished it. Ticking off your own task needs no announcement.
    const todo = rows[0];
    if (done && todo?.created_by && todo.created_by !== req.user.id) {
      notify(
        [todo.created_by],
        `${req.user.name} completed a task you assigned`,
        [
          `<strong>${req.user.name}</strong> has marked this as done:`,
          `<strong>${escapeHtml(todo.description)}</strong>`,
        ]
      );
    }
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
