const pool = require('../db/pool');
const { normaliseRole } = require('../middleware/auth');

async function list(req, res) {
  const { from, to, tech, appointment_type } = req.query;
  const conditions = ['1=1'];
  const params = [];
  let p = 1;

  if (from) { conditions.push(`s.scheduled_date >= $${p}`); params.push(from); p++; }
  if (to)   { conditions.push(`s.scheduled_date <= $${p}`); params.push(to);   p++; }
  if (tech) { conditions.push(`s.user_id = $${p}`);         params.push(tech); p++; }
  if (appointment_type) { conditions.push(`s.appointment_type = $${p}`); params.push(appointment_type); p++; }

  // Non-admin users only see their own appointments
  if (normaliseRole(req.user.role) !== 'admin') {
    conditions.push(`s.user_id = $${p}`);
    params.push(req.user.id); p++;
  }

  try {
    const { rows } = await pool.query(
      `SELECT s.*,
              j.job_number, j.external_ref, j.type AS job_type, j.status, j.description,
              c.name AS customer_name,
              COALESCE(cs.address, j.site_address) AS site_address,
              u.name AS tech_name
       FROM schedules s
       JOIN jobs j ON j.id = s.job_id
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN customer_sites cs ON cs.id = j.site_id
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
  const { job_id, user_id, scheduled_date, start_time, end_time, appointment_type, notes } = req.body;
  if (!job_id || !user_id || !scheduled_date) {
    return res.status(400).json({ error: 'job_id, user_id and scheduled_date are required' });
  }
  if (appointment_type && !['sales', 'operations'].includes(appointment_type)) {
    return res.status(400).json({ error: 'appointment_type must be "sales" or "operations"' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO schedules (job_id, user_id, scheduled_date, start_time, end_time, appointment_type, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [job_id, user_id, scheduled_date, start_time || null, end_time || null, appointment_type || null, notes || null]
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

// Partial update — only fields present in the body are changed. Used for the
// edit form, drag/resize on the calendar, and the notes-only save from the
// appointment detail popup, each of which sends a different subset of fields.
async function update(req, res) {
  const { user_id, scheduled_date, start_time, end_time, appointment_type, notes } = req.body;
  if (appointment_type && !['sales', 'operations'].includes(appointment_type)) {
    return res.status(400).json({ error: 'appointment_type must be "sales" or "operations"' });
  }
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM schedules WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Appointment not found' });
    const existing = existingRows[0];
    const merged = {
      user_id:          user_id          !== undefined ? user_id                    : existing.user_id,
      scheduled_date:   scheduled_date   !== undefined ? scheduled_date             : existing.scheduled_date,
      start_time:       start_time       !== undefined ? (start_time || null)       : existing.start_time,
      end_time:         end_time         !== undefined ? (end_time || null)         : existing.end_time,
      appointment_type: appointment_type !== undefined ? (appointment_type || null) : existing.appointment_type,
      notes:            notes            !== undefined ? (notes || null)            : existing.notes,
    };
    const { rows } = await pool.query(
      `UPDATE schedules SET user_id=$1, scheduled_date=$2, start_time=$3, end_time=$4, appointment_type=$5, notes=$6
       WHERE id=$7 RETURNING *`,
      [merged.user_id, merged.scheduled_date, merged.start_time, merged.end_time, merged.appointment_type, merged.notes, req.params.id]
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
