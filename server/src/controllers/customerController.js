const pool = require('../db/pool');

async function list(req, res) {
  const { search = '', page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.company, c.phone, c.email, c.created_at,
              COUNT(DISTINCT j.id) AS job_count,
              COUNT(DISTINCT s.id) AS site_count
       FROM customers c
       LEFT JOIN jobs j ON j.customer_id = c.id
       LEFT JOIN customer_sites s ON s.customer_id = c.id
       WHERE c.name ILIKE $1 OR c.company ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1
       GROUP BY c.id
       ORDER BY c.name
       LIMIT $2 OFFSET $3`,
      [`%${search}%`, limit, offset]
    );
    const total = await pool.query(
      `SELECT COUNT(*) FROM customers WHERE name ILIKE $1 OR company ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1`,
      [`%${search}%`]
    );
    res.json({ customers: rows, total: parseInt(total.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function get(req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
    const sites = await pool.query('SELECT * FROM customer_sites WHERE customer_id = $1 ORDER BY label', [req.params.id]);
    const jobs = await pool.query(
      `SELECT j.id, j.job_number, j.type, j.status, j.priority, j.due_date, j.description,
              u.name AS lead_tech_name
       FROM jobs j LEFT JOIN users u ON u.id = j.lead_tech_id
       WHERE j.customer_id = $1 ORDER BY j.created_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ ...rows[0], sites: sites.rows, recent_jobs: jobs.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function create(req, res) {
  const { name, company, phone, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO customers (name, company, phone, email) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, company || null, phone || null, email || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function update(req, res) {
  const { name, company, phone, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      'UPDATE customers SET name=$1, company=$2, phone=$3, email=$4, updated_at=NOW() WHERE id=$5 RETURNING *',
      [name, company || null, phone || null, email || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function remove(req, res) {
  try {
    await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Customer deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function listSites(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM customer_sites WHERE customer_id = $1 ORDER BY label',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function createSite(req, res) {
  const { address, label } = req.body;
  if (!address) return res.status(400).json({ error: 'Address is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO customer_sites (customer_id, address, label) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, address, label || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateSite(req, res) {
  const { address, label } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE customer_sites SET address=$1, label=$2 WHERE id=$3 AND customer_id=$4 RETURNING *',
      [address, label || null, req.params.siteId, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteSite(req, res) {
  try {
    await pool.query('DELETE FROM customer_sites WHERE id=$1 AND customer_id=$2', [req.params.siteId, req.params.id]);
    res.json({ message: 'Site deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function listNotes(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT n.*, u.name AS author_name FROM customer_notes n
       JOIN users u ON u.id = n.user_id
       WHERE n.customer_id = $1 ORDER BY n.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function createNote(req, res) {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Note content is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO customer_notes (customer_id, user_id, content) VALUES ($1, $2, $3)
       RETURNING id, customer_id, user_id, content, created_at`,
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
    await pool.query('DELETE FROM customer_notes WHERE id=$1 AND customer_id=$2', [req.params.noteId, req.params.id]);
    res.json({ message: 'Note deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function importCsv(req, res) {
  const { rows: csvRows } = req.body;
  if (!Array.isArray(csvRows) || csvRows.length === 0) {
    return res.status(400).json({ error: 'No data provided' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let imported = 0;
    for (const row of csvRows) {
      if (!row.name) continue;
      await client.query(
        'INSERT INTO customers (name, company, phone, email) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [row.name, row.company || null, row.phone || null, row.email || null]
      );
      imported++;
    }
    await client.query('COMMIT');
    res.json({ imported });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Import failed' });
  } finally {
    client.release();
  }
}

module.exports = { list, get, create, update, remove, listSites, createSite, updateSite, deleteSite, listNotes, createNote, deleteNote, importCsv };
