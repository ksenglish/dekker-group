const pool = require('../db/pool');

async function list(req, res) {
  const { job_id, user_id, from, to } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;

  // Field techs can only see their own entries
  if (req.user.role === 'field_tech') {
    conditions.push(`t.user_id = $${p}`); params.push(req.user.id); p++;
  } else {
    if (user_id) { conditions.push(`t.user_id = $${p}`); params.push(user_id); p++; }
  }
  if (job_id) { conditions.push(`t.job_id = $${p}`); params.push(job_id); p++; }
  if (from)   { conditions.push(`t.date >= $${p}`); params.push(from); p++; }
  if (to)     { conditions.push(`t.date <= $${p}`); params.push(to); p++; }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const { rows } = await pool.query(
      `SELECT t.*, u.name AS user_name, j.title AS job_title, j.job_number
       FROM timesheets t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN jobs j ON j.id = t.job_id
       ${where}
       ORDER BY t.date DESC, t.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function create(req, res) {
  const { job_id, date, hours, description } = req.body;
  const user_id = req.user.role === 'field_tech' ? req.user.id : (req.body.user_id || req.user.id);
  if (!hours || hours <= 0) return res.status(400).json({ error: 'Hours must be greater than 0' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO timesheets (job_id, user_id, date, hours, description)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [job_id || null, user_id, date || new Date().toISOString().slice(0,10), hours, description || null]
    );
    // Fetch with joins
    const { rows: full } = await pool.query(
      `SELECT t.*, u.name AS user_name, j.title AS job_title, j.job_number
       FROM timesheets t LEFT JOIN users u ON u.id=t.user_id LEFT JOIN jobs j ON j.id=t.job_id
       WHERE t.id=$1`, [rows[0].id]
    );
    res.status(201).json(full[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function update(req, res) {
  const { job_id, date, hours, description, user_id } = req.body;
  const { id } = req.params;
  try {
    // Field techs can only edit their own
    const { rows: [existing] } = await pool.query('SELECT * FROM timesheets WHERE id=$1', [id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'field_tech' && existing.user_id !== req.user.id)
      return res.status(403).json({ error: 'Forbidden' });

    const newUserId = req.user.role === 'field_tech' ? req.user.id : (user_id || existing.user_id);
    const { rows } = await pool.query(
      `UPDATE timesheets SET job_id=$1, user_id=$2, date=$3, hours=$4, description=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [job_id || null, newUserId, date, hours, description || null, id]
    );
    const { rows: full } = await pool.query(
      `SELECT t.*, u.name AS user_name, j.title AS job_title, j.job_number
       FROM timesheets t LEFT JOIN users u ON u.id=t.user_id LEFT JOIN jobs j ON j.id=t.job_id
       WHERE t.id=$1`, [rows[0].id]
    );
    res.json(full[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function remove(req, res) {
  try {
    const { rows: [existing] } = await pool.query('SELECT * FROM timesheets WHERE id=$1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'field_tech' && existing.user_id !== req.user.id)
      return res.status(403).json({ error: 'Forbidden' });
    await pool.query('DELETE FROM timesheets WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function summary(req, res) {
  const { from, to, user_id } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;
  if (req.user.role === 'field_tech') { conditions.push(`t.user_id=$${p}`); params.push(req.user.id); p++; }
  else if (user_id) { conditions.push(`t.user_id=$${p}`); params.push(user_id); p++; }
  if (from) { conditions.push(`t.date>=$${p}`); params.push(from); p++; }
  if (to)   { conditions.push(`t.date<=$${p}`); params.push(to); p++; }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const { rows } = await pool.query(
      `SELECT u.name AS user_name, u.id AS user_id,
              SUM(t.hours) AS total_hours,
              COUNT(DISTINCT t.job_id) AS job_count
       FROM timesheets t LEFT JOIN users u ON u.id=t.user_id
       ${where}
       GROUP BY u.id, u.name ORDER BY u.name`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

module.exports = { list, create, update, remove, summary };
