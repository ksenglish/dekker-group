const pool = require('../db/pool');

async function list(req, res) {
  const { from, to, tech } = req.query;
  const conditions = ['1=1'];
  const params = [];
  let p = 1;

  if (from) { conditions.push(`s.scheduled_date >= $${p}`); params.push(from); p++; }
  if (to)   { conditions.push(`s.scheduled_date <= $${p}`); params.push(to);   p++; }
  if (tech) { conditions.push(`s.user_id = $${p}`);         params.push(tech); p++; }

  if (req.user.role === 'field_tech' || req.user.role === 'subcontractor') {
    conditions.push(`s.user_id = $${p}`);
    params.push(req.user.id); p++;
  }

  try {
    const { rows } = await pool.query(
      `SELECT s.*,
              j.job_number, j.type AS job_type, j.status, j.description,
              c.name AS customer_name,
              u.name AS tech_name
       FROM schedules s
       JOIN jobs j ON j.id = s.job_id
       LEFT JOIN customers c ON c.id = j.customer_id
       JOIN users u ON u.id = s.user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.scheduled_date, s.start_time`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function create(req, res) {
  const { job_id, user_id, scheduled_date, start_time, end_time } = req.body;
  if (!job_id || !user_id || !scheduled_date) {
    return res.status(400).json({ error: 'job_id, user_id and scheduled_date are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO schedules (job_id, user_id, scheduled_date, start_time, end_time)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [job_id, user_id, scheduled_date, start_time || null, end_time || null]
    );
    // Also update job status to scheduled if it's still 'new'
    await pool.query(
      `UPDATE jobs SET status='scheduled', updated_at=NOW() WHERE id=$1 AND status='new'`,
      [job_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function update(req, res) {
  const { user_id, scheduled_date, start_time, end_time } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE schedules SET user_id=$1, scheduled_date=$2, start_time=$3, end_time=$4
       WHERE id=$5 RETURNING *`,
      [user_id, scheduled_date, start_time || null, end_time || null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function remove(req, res) {
  try {
    await pool.query('DELETE FROM schedules WHERE id=$1', [req.params.id]);
    res.json({ message: 'Removed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

// Drag-to-reschedule: updates job due_date and any schedule entries
async function reschedule(req, res) {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });
  try {
    await pool.query(
      'UPDATE jobs SET due_date=$1, updated_at=NOW() WHERE id=$2',
      [date, req.params.jobId]
    );
    await pool.query(
      'UPDATE schedules SET scheduled_date=$1 WHERE job_id=$2',
      [date, req.params.jobId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { list, create, update, remove, reschedule };
