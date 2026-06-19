const pool = require('../db/pool');

async function list(req, res) {
  const { search = '', status, tech, customer, priority, from, to, page = 1, limit = 100 } = req.query;
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  let p = 1;

  if (search) {
    conditions.push(`(j.description ILIKE $${p} OR c.name ILIKE $${p} OR j.job_number::text ILIKE $${p})`);
    params.push(`%${search}%`); p++;
  }
  if (status) { conditions.push(`j.status = $${p}`); params.push(status); p++; }
  if (tech) { conditions.push(`j.lead_tech_id = $${p}`); params.push(tech); p++; }
  if (customer) { conditions.push(`j.customer_id = $${p}`); params.push(customer); p++; }
  if (priority) { conditions.push(`j.priority = $${p}`); params.push(priority); p++; }
  if (from) { conditions.push(`j.due_date >= $${p}`); params.push(from); p++; }
  if (to) { conditions.push(`j.due_date <= $${p}`); params.push(to); p++; }

  // Field techs only see their own jobs
  if (req.user.role === 'field_tech') {
    conditions.push(`j.lead_tech_id = $${p}`);
    params.push(req.user.id); p++;
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const { rows } = await pool.query(
      `SELECT j.id, j.job_number, j.type, j.status, j.priority, j.description,
              j.due_date, j.created_at,
              c.id AS customer_id, c.name AS customer_name,
              u.id AS tech_id, u.name AS tech_name,
              s.address AS site_address
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN users u ON u.id = j.lead_tech_id
       LEFT JOIN customer_sites s ON s.id = j.site_id
       ${where}
       ORDER BY j.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    );
    const total = await pool.query(
      `SELECT COUNT(*) FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id ${where}`,
      params
    );
    res.json({ jobs: rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function get(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT j.*,
              c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
              u.name AS tech_name,
              s.address AS site_address, s.label AS site_label
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN users u ON u.id = j.lead_tech_id
       LEFT JOIN customer_sites s ON s.id = j.site_id
       WHERE j.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Job not found' });

    const items = await pool.query('SELECT * FROM line_items WHERE job_id = $1 ORDER BY created_at', [req.params.id]);
    const notes = await pool.query(
      `SELECT n.*, u.name AS author_name FROM job_notes n JOIN users u ON u.id = n.user_id
       WHERE n.job_id = $1 ORDER BY n.created_at DESC`,
      [req.params.id]
    );

    res.json({ ...rows[0], line_items: items.rows, notes: notes.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function create(req, res) {
  const { customer_id, site_id, type, description, priority, lead_tech_id, due_date } = req.body;
  if (!type) return res.status(400).json({ error: 'Job type is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO jobs (customer_id, site_id, type, description, priority, lead_tech_id, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [customer_id || null, site_id || null, type, description || null,
       priority || 'medium', lead_tech_id || null, due_date || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function update(req, res) {
  const { customer_id, site_id, type, description, priority, lead_tech_id, due_date, status } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE jobs SET customer_id=$1, site_id=$2, type=$3, description=$4, priority=$5,
       lead_tech_id=$6, due_date=$7, status=COALESCE($8, status), updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [customer_id || null, site_id || null, type, description || null,
       priority || 'medium', lead_tech_id || null, due_date || null, status || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateStatus(req, res) {
  const { status } = req.body;
  const valid = ['new', 'quoted', 'scheduled', 'in_progress', 'invoiced', 'complete', 'cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows } = await pool.query(
      'UPDATE jobs SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function remove(req, res) {
  try {
    await pool.query('DELETE FROM jobs WHERE id=$1', [req.params.id]);
    res.json({ message: 'Job deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateLineItems(req, res) {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Items must be an array' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM line_items WHERE job_id=$1', [req.params.id]);
    for (const item of items) {
      if (!item.description) continue;
      await client.query(
        'INSERT INTO line_items (job_id, description, quantity, unit_price, product_id) VALUES ($1,$2,$3,$4,$5)',
        [req.params.id, item.description, item.quantity || 1, Math.round((item.unit_price || 0) * 100), item.product_id || null]
      );
    }
    await client.query('COMMIT');
    const { rows } = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [req.params.id]);
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

async function listNotes(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT n.*, u.name AS author_name FROM job_notes n JOIN users u ON u.id = n.user_id
       WHERE n.job_id=$1 ORDER BY n.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function createNote(req, res) {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO job_notes (job_id, user_id, content) VALUES ($1,$2,$3)
       RETURNING id, job_id, user_id, content, created_at`,
      [req.params.id, req.user.id, content.trim()]
    );
    const note = rows[0];
    note.author_name = req.user.name;
    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteNote(req, res) {
  try {
    await pool.query('DELETE FROM job_notes WHERE id=$1 AND job_id=$2', [req.params.noteId, req.params.id]);
    res.json({ message: 'Note deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { list, get, create, update, updateStatus, remove, updateLineItems, listNotes, createNote, deleteNote };
