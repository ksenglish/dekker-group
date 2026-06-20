const pool = require('../db/pool');
const bcrypt = require('bcryptjs');

async function list(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, is_active, created_at FROM users ORDER BY name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function create(req, res) {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Name, email, password and role are required' });
  const valid = ['admin', 'office', 'field_tech'];
  if (!valid.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)
       RETURNING id, name, email, role, is_active, created_at`,
      [name, email.toLowerCase(), hash, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
}

async function update(req, res) {
  const { name, email, role, is_active, password } = req.body;
  const { id } = req.params;
  if (id === req.user.id && is_active === false) return res.status(400).json({ error: 'You cannot deactivate your own account' });
  try {
    let query, params;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      query = `UPDATE users SET name=$1, email=$2, role=$3, is_active=$4, password_hash=$5 WHERE id=$6
               RETURNING id, name, email, role, is_active, created_at`;
      params = [name, email.toLowerCase(), role, is_active !== false, hash, id];
    } else {
      query = `UPDATE users SET name=$1, email=$2, role=$3, is_active=$4 WHERE id=$5
               RETURNING id, name, email, role, is_active, created_at`;
      params = [name, email.toLowerCase(), role, is_active !== false, id];
    }
    const { rows } = await pool.query(query, params);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
}

async function remove(req, res) {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

module.exports = { list, create, update, remove };
