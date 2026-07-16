const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendResetEmail } = require('../controllers/authController');

// Which diaries (Schedule calendars) a user can appear under
const VALID_DIARIES = ['admin', 'sales', 'operations', 'subcontractor'];

function diariesFromRole(role) {
  if (role === 'admin') return ['admin'];
  if (role === 'sales') return ['sales'];
  if (role === 'operations' || role === 'office') return ['operations'];
  if (role === 'subcontractor' || role === 'field_tech') return ['subcontractor'];
  return [];
}

function validDiaries(diaries) {
  return Array.isArray(diaries) && diaries.every(d => VALID_DIARIES.includes(d));
}

// Get all users — any authenticated role can read the team roster (needed by
// the Schedule page to render team-member columns/names for every role, not
// just admin); create/update/delete/invite/unlock stay admin-only below.
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, diaries, default_billing_rate_id, is_active, created_at FROM users ORDER BY name'
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create user (admin only)
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { name, email, password, role, diaries, default_billing_rate_id } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!['admin', 'sales', 'operations', 'subcontractor', 'office', 'field_tech'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (diaries !== undefined && !validDiaries(diaries)) {
    return res.status(400).json({ error: 'Invalid diaries' });
  }
  try {
    const password_hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash, role, diaries, default_billing_rate_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role, diaries, default_billing_rate_id, created_at',
      [name, email.toLowerCase().trim(), password_hash, role, diaries !== undefined ? diaries : diariesFromRole(role), default_billing_rate_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user (admin only)
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { name, email, role, password, is_active, diaries, default_billing_rate_id } = req.body;
  if (req.params.id === req.user.id && is_active === false)
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  if (diaries !== undefined && !validDiaries(diaries)) {
    return res.status(400).json({ error: 'Invalid diaries' });
  }
  try {
    // Keep existing diaries/rate when the request doesn't include them
    const { rows: existingRows } = await pool.query('SELECT diaries, default_billing_rate_id FROM users WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'User not found' });
    const finalDiaries = diaries !== undefined ? diaries : existingRows[0].diaries;
    const finalRateId = default_billing_rate_id !== undefined ? (default_billing_rate_id || null) : existingRows[0].default_billing_rate_id;

    if (password) {
      const password_hash = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        'UPDATE users SET name=$1, email=$2, role=$3, password_hash=$4, is_active=$5, diaries=$6, default_billing_rate_id=$7, updated_at=NOW() WHERE id=$8 RETURNING id, name, email, role, diaries, default_billing_rate_id, is_active, created_at',
        [name, email.toLowerCase().trim(), role, password_hash, is_active !== false, finalDiaries, finalRateId, req.params.id]
      );
      return res.json(rows[0]);
    }
    const { rows } = await pool.query(
      'UPDATE users SET name=$1, email=$2, role=$3, is_active=$4, diaries=$5, default_billing_rate_id=$6, updated_at=NOW() WHERE id=$7 RETURNING id, name, email, role, diaries, default_billing_rate_id, is_active, created_at',
      [name, email.toLowerCase().trim(), role, is_active !== false, finalDiaries, finalRateId, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Send invite email (admin only)
router.post('/:id/invite', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, email FROM users WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const { name, email } = rows[0];
    await sendResetEmail({
      userId: rows[0].id, userEmail: email, userName: name,
      subject: `You've been invited to Dekker App`,
      bodyHeading: `Welcome to Dekker App, ${name}!`,
      bodyText: `You've been added as a team member. Click the button below to set your password and get started.`,
      buttonLabel: 'Set My Password',
    });
    res.json({ message: `Invite sent to ${email}` });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: err.message || 'Failed to send invite' });
  }
});

// Unlock account — clear login_attempts for this user's email (admin only)
router.post('/:id/unlock', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT email FROM users WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    await pool.query('DELETE FROM login_attempts WHERE identifier = $1', [rows[0].email.toLowerCase()]);
    res.json({ message: `Account unlocked for ${rows[0].email}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user (admin only)
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
