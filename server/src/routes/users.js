const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendResetEmail } = require('../controllers/authController');

// Get all users (admin only)
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY name'
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create user (admin only)
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!['admin', 'sales', 'operations', 'subcontractor', 'office', 'field_tech'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const password_hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
      [name, email.toLowerCase().trim(), password_hash, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user (admin only)
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { name, email, role, password, is_active } = req.body;
  if (req.params.id === req.user.id && is_active === false)
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  try {
    if (password) {
      const password_hash = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        'UPDATE users SET name=$1, email=$2, role=$3, password_hash=$4, is_active=$5, updated_at=NOW() WHERE id=$6 RETURNING id, name, email, role, is_active, created_at',
        [name, email.toLowerCase().trim(), role, password_hash, is_active !== false, req.params.id]
      );
      return res.json(rows[0]);
    }
    const { rows } = await pool.query(
      'UPDATE users SET name=$1, email=$2, role=$3, is_active=$4, updated_at=NOW() WHERE id=$5 RETURNING id, name, email, role, is_active, created_at',
      [name, email.toLowerCase().trim(), role, is_active !== false, req.params.id]
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
