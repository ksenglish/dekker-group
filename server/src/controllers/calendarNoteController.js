const pool = require('../db/pool');
const { normaliseRole } = require('../middleware/auth');

// Advance `date` forward to the recurrence unit
function advance(date, recurrence) {
  const d = new Date(date);
  if (recurrence === 'daily') d.setDate(d.getDate() + 1);
  else if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
  return d;
}

// Expand a note's recurrence into concrete occurrence dates within [from, to]
function expandOccurrences(note, from, to) {
  const anchor = new Date(note.note_date);
  const fromD = new Date(from);
  const toD = new Date(to);
  const occurrences = [];

  if (note.recurrence === 'none') {
    if (anchor >= fromD && anchor <= toD) occurrences.push(new Date(anchor));
    return occurrences;
  }

  let d = new Date(anchor);
  let guard = 0;
  // Fast-forward to the first occurrence on/after `from` without an unbounded loop
  while (d < fromD && guard < 2000) { d = advance(d, note.recurrence); guard++; }
  while (d <= toD && guard < 2000) {
    occurrences.push(new Date(d));
    d = advance(d, note.recurrence);
    guard++;
  }
  return occurrences;
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function list(req, res) {
  const { from, to, tech } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  const conditions = ['1=1'];
  const params = [];
  let p = 1;

  if (tech) { conditions.push(`n.user_id = $${p}`); params.push(tech); p++; }

  // Non-admin users only see their own notes
  if (normaliseRole(req.user.role) !== 'admin') {
    conditions.push(`n.user_id = $${p}`);
    params.push(req.user.id); p++;
  }

  try {
    // Fetch any note whose anchor date could produce an occurrence in range —
    // recurring notes may have started well before `from`
    const { rows } = await pool.query(
      `SELECT n.*, u.name AS tech_name
       FROM calendar_notes n
       JOIN users u ON u.id = n.user_id
       WHERE ${conditions.join(' AND ')} AND n.note_date <= $${p}
       ORDER BY n.note_date`,
      [...params, to]
    );
    const expanded = [];
    for (const note of rows) {
      const occurrences = expandOccurrences(note, from, to);
      for (const occ of occurrences) {
        expanded.push({ ...note, occurrence_date: toDateStr(occ) });
      }
    }
    res.json(expanded);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function create(req, res) {
  const { user_id, note, note_date, start_time, end_time, recurrence } = req.body;
  if (!user_id || !note?.trim() || !note_date) {
    return res.status(400).json({ error: 'user_id, note and note_date are required' });
  }
  if (recurrence && !['none', 'daily', 'weekly', 'monthly'].includes(recurrence)) {
    return res.status(400).json({ error: 'Invalid recurrence' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO calendar_notes (user_id, note, note_date, start_time, end_time, recurrence, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [user_id, note.trim(), note_date, start_time || null, end_time || null, recurrence || 'none', req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function remove(req, res) {
  try {
    await pool.query('DELETE FROM calendar_notes WHERE id=$1', [req.params.id]);
    res.json({ message: 'Removed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { list, create, remove };
