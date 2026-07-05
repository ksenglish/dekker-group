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

// Expand a note's recurrence into concrete occurrence dates within [from, to],
// skipping any dates deleted individually via "delete just this occurrence"
function expandOccurrences(note, from, to) {
  const anchor = new Date(note.note_date);
  const fromD = new Date(from);
  const toD = new Date(to);
  const excluded = new Set(note.excluded_dates || []);
  const occurrences = [];
  const keep = d => !excluded.has(toDateStr(d));

  if (note.recurrence === 'none') {
    if (anchor >= fromD && anchor <= toD && keep(anchor)) occurrences.push(new Date(anchor));
    return occurrences;
  }

  let d = new Date(anchor);
  let guard = 0;
  // Fast-forward to the first occurrence on/after `from` without an unbounded loop
  while (d < fromD && guard < 2000) { d = advance(d, note.recurrence); guard++; }
  while (d <= toD && guard < 2000) {
    if (keep(d)) occurrences.push(new Date(d));
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

// Partial update — only fields present in the body are changed
async function update(req, res) {
  const { user_id, note, note_date, start_time, end_time, recurrence } = req.body;
  if (recurrence !== undefined && !['none', 'daily', 'weekly', 'monthly'].includes(recurrence)) {
    return res.status(400).json({ error: 'Invalid recurrence' });
  }
  if (note !== undefined && !note.trim()) {
    return res.status(400).json({ error: 'Note cannot be empty' });
  }
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM calendar_notes WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Note not found' });
    const existing = existingRows[0];
    const merged = {
      user_id:    user_id    !== undefined ? user_id              : existing.user_id,
      note:       note       !== undefined ? note.trim()          : existing.note,
      note_date:  note_date  !== undefined ? note_date            : existing.note_date,
      start_time: start_time !== undefined ? (start_time || null) : existing.start_time,
      end_time:   end_time   !== undefined ? (end_time || null)   : existing.end_time,
      recurrence: recurrence !== undefined ? recurrence           : existing.recurrence,
    };
    const { rows } = await pool.query(
      `UPDATE calendar_notes SET user_id=$1, note=$2, note_date=$3, start_time=$4, end_time=$5, recurrence=$6
       WHERE id=$7 RETURNING *`,
      [merged.user_id, merged.note, merged.note_date, merged.start_time, merged.end_time, merged.recurrence, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// "Delete just this occurrence" — adds one date to a recurring note's exclusion list
async function excludeOccurrence(req, res) {
  const { date } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE calendar_notes
       SET excluded_dates = array_append(excluded_dates, $1)
       WHERE id=$2 AND NOT ($1 = ANY(excluded_dates))
       RETURNING *`,
      [date, req.params.id]
    );
    res.json(rows[0] || { message: 'Already excluded' });
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

module.exports = { list, create, update, excludeOccurrence, remove };
