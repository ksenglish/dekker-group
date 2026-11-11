const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { PERMISSIONS, cleanPermissions, GRANTABLE_ROLES } = require('../utils/permissions');
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

// An hourly cost is optional — an empty box means "not set", which the Time
// tab reports rather than treating as free labour. Anything unparseable or
// negative is stored as not set, for the same reason.
// How this person gets around on a phone: the bottom rail, or a menu. Only
// those two, and anything else reads as the rail, because the rail is what
// everybody has had until now and is the safe thing to land on.
const mobileNav = v => (v === 'menu' ? 'menu' : 'rail');

function costRateOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Extra access is only offered to the roles it means anything for: an admin
// already has the lot, and a subcontractor's access is their own work on site.
// Switching someone to one of those roles clears whatever was ticked, so a
// stale grant can't come back if they're switched to sales again later.
// Which rates this person may log against. An empty list means every rate,
// stored as NULL so the column says the same thing the rule does.
function rateList(input) {
  if (!Array.isArray(input)) return null;
  const clean = [...new Set(input.map(x => String(x).trim()).filter(Boolean))];
  return clean.length ? JSON.stringify(clean) : null;
}

function permissionsFor(role, input, current) {
  if (!GRANTABLE_ROLES.includes(role)) return {};
  return input !== undefined ? cleanPermissions(input) : (current || {});
}

function validDiaries(diaries) {
  return Array.isArray(diaries) && diaries.every(d => VALID_DIARIES.includes(d));
}

// Get all users — any authenticated role can read the team roster (needed by
// the Schedule page to render team-member columns/names for every role, not
// just admin); create/update/delete/invite/unlock stay admin-only below.
router.get('/', authenticate, async (req, res) => {
  try {
    // What each person costs per hour is admin-only — this endpoint is readable
    // by the whole team, so the column is left out of the query entirely rather
    // than fetched and stripped.
    // Hourly cost and who holds which extra access are both admin's business.
    // This endpoint is readable by the whole team, so the columns are left out
    // of the query rather than fetched and stripped.
    const adminOnly = req.user.role === 'admin' ? ', cost_rate, permissions' : '';
    const { rows } = await pool.query(
      `SELECT id, name, email, role, diaries, default_billing_rate_id, billing_rate_ids, licence_number, mobile, mobile_nav, address, gst_number, gst_registered, is_active, created_at${adminOnly} FROM users ORDER BY name`
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// The extra-access catalogue, so the Users page doesn't keep a second copy of
// it that can drift from the one the checks actually use.
router.get('/permission-options', authenticate, requireRole('admin'), (req, res) => {
  res.json({ permissions: PERMISSIONS, grantable_roles: GRANTABLE_ROLES });
});

// Create user (admin only)
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { name, email, password, role, diaries, default_billing_rate_id, billing_rate_ids,
          licence_number, mobile, mobile_nav,
          address, gst_number, gst_registered, cost_rate, permissions } = req.body;
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
      'INSERT INTO users (name, email, password_hash, role, diaries, default_billing_rate_id, billing_rate_ids, licence_number, mobile, mobile_nav, address, gst_number, gst_registered, cost_rate, permissions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id, name, email, role, diaries, default_billing_rate_id, billing_rate_ids, licence_number, mobile, mobile_nav, address, gst_number, gst_registered, cost_rate, permissions, created_at',
      [name, email.toLowerCase().trim(), password_hash, role, diaries !== undefined ? diaries : diariesFromRole(role), default_billing_rate_id || null, rateList(billing_rate_ids), licence_number || null, mobile || null,
       mobileNav(mobile_nav), address || null, gst_number || null, !!gst_registered, costRateOrNull(cost_rate),
       permissionsFor(role, permissions, null)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user (admin only)
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { name, email, role, password, is_active, diaries, default_billing_rate_id, billing_rate_ids,
          licence_number, mobile, mobile_nav,
          address, gst_number, gst_registered, cost_rate, permissions } = req.body;
  if (req.params.id === req.user.id && is_active === false)
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  if (diaries !== undefined && !validDiaries(diaries)) {
    return res.status(400).json({ error: 'Invalid diaries' });
  }
  try {
    // Keep existing diaries/rate/billing details when the request omits them
    const { rows: existingRows } = await pool.query(
      'SELECT diaries, default_billing_rate_id, billing_rate_ids, address, gst_number, gst_registered, cost_rate, permissions, mobile_nav FROM users WHERE id=$1',
      [req.params.id]
    );
    if (!existingRows[0]) return res.status(404).json({ error: 'User not found' });
    const cur = existingRows[0];
    const finalDiaries = diaries !== undefined ? diaries : cur.diaries;
    const finalRateId = default_billing_rate_id !== undefined ? (default_billing_rate_id || null) : cur.default_billing_rate_id;
    const finalAddress = address !== undefined ? (address || null) : cur.address;
    const finalGstNumber = gst_number !== undefined ? (gst_number || null) : cur.gst_number;
    const finalGstRegistered = gst_registered !== undefined ? !!gst_registered : cur.gst_registered;
    const finalCostRate = cost_rate !== undefined ? costRateOrNull(cost_rate) : cur.cost_rate;
    const finalPermissions = permissionsFor(role, permissions, cur.permissions);
    // Left alone where the form did not mention it, so a screen that knows
    // nothing about this setting cannot quietly put somebody back on the rail.
    const finalMobileNav = mobile_nav !== undefined ? mobileNav(mobile_nav) : cur.mobile_nav;
    // Same again: a screen that says nothing about which rates somebody may
    // use must not be able to hand them all of them back.
    const finalRateIds = billing_rate_ids !== undefined
      ? rateList(billing_rate_ids)
      : (cur.billing_rate_ids ? JSON.stringify(cur.billing_rate_ids) : null);

    if (password) {
      const password_hash = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        'UPDATE users SET name=$1, email=$2, role=$3, password_hash=$4, is_active=$5, diaries=$6, default_billing_rate_id=$7, licence_number=$8, mobile=$9, mobile_nav=$16, address=$10, gst_number=$11, gst_registered=$12, cost_rate=$13, permissions=$14, billing_rate_ids=$17, updated_at=NOW() WHERE id=$15 RETURNING id, name, email, role, diaries, default_billing_rate_id, billing_rate_ids, licence_number, mobile, mobile_nav, address, gst_number, gst_registered, cost_rate, permissions, is_active, created_at',
        [name, email.toLowerCase().trim(), role, password_hash, is_active !== false, finalDiaries, finalRateId, licence_number || null, mobile || null,
         finalAddress, finalGstNumber, finalGstRegistered, finalCostRate, finalPermissions, req.params.id, finalMobileNav, finalRateIds]
      );
      return res.json(rows[0]);
    }
    const { rows } = await pool.query(
      'UPDATE users SET name=$1, email=$2, role=$3, is_active=$4, diaries=$5, default_billing_rate_id=$6, licence_number=$7, mobile=$8, mobile_nav=$15, address=$9, gst_number=$10, gst_registered=$11, cost_rate=$12, permissions=$13, billing_rate_ids=$16, updated_at=NOW() WHERE id=$14 RETURNING id, name, email, role, diaries, default_billing_rate_id, billing_rate_ids, licence_number, mobile, mobile_nav, address, gst_number, gst_registered, cost_rate, permissions, is_active, created_at',
      [name, email.toLowerCase().trim(), role, is_active !== false, finalDiaries, finalRateId, licence_number || null, mobile || null,
       finalAddress, finalGstNumber, finalGstRegistered, finalCostRate, finalPermissions, req.params.id, finalMobileNav, finalRateIds]
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
