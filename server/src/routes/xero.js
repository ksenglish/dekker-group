const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { verifyRefreshToken } = require('../utils/jwt');
const xero = require('../utils/xero');

const STATE_COOKIE = 'xero_oauth_state';

// A plain <a href> navigation (required for the OAuth redirect chain to
// work) can't carry the app's Bearer access token — the `authenticate`
// middleware would always 401 it. Verify the refreshToken cookie instead,
// the same way authController.js's /refresh endpoint does.
async function requireAdminViaCookie(req, res, next) {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).send('Please log in to Dekker App first');
  try {
    const decoded = verifyRefreshToken(token);
    const { rows } = await pool.query(
      'SELECT id FROM refresh_tokens WHERE token=$1 AND user_id=$2 AND expires_at > NOW()',
      [token, decoded.id]
    );
    if (!rows.length) return res.status(401).send('Session expired — please log in again');
    const { rows: [user] } = await pool.query('SELECT id, role FROM users WHERE id=$1', [decoded.id]);
    if (!user || user.role !== 'admin') return res.status(403).send('Admin access required');
    req.user = user;
    next();
  } catch (err) {
    res.status(401).send('Please log in to Dekker App first');
  }
}

// Start the OAuth consent flow — must be a real browser navigation (the
// button on the Settings page links here directly), not an axios call.
router.get('/connect', requireAdminViaCookie, async (req, res) => {
  try {
    const state = crypto.randomBytes(24).toString('hex');
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 10 * 60 * 1000,
    });
    const url = await xero.buildAuthorizeUrl(state);
    res.redirect(url);
  } catch (err) {
    console.error('Xero connect failed:', err);
    res.status(500).send('Failed to start Xero connection');
  }
});

// Xero redirects the browser here after consent — public, no session cookie
// from our own app is guaranteed to be present on this cross-site redirect.
router.get('/callback', async (req, res) => {
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE);
  try {
    if (!expectedState) throw new Error('Missing OAuth state — please try connecting again');
    await xero.completeConnection(req.originalUrl, expectedState);
    res.redirect('/settings?tab=Integrations&xero=connected');
  } catch (err) {
    console.error('Xero callback failed:', err);
    res.redirect('/settings?tab=Integrations&xero=error');
  }
});

router.post('/disconnect', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await xero.revokeConnection().catch(err => console.error('Xero revoke (non-fatal):', err.message));
    await xero.clearXeroConnection();
    res.json({ message: 'Disconnected' });
  } catch (err) {
    console.error('Xero disconnect failed:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

router.get('/accounts', authenticate, requireRole('admin', 'office'), async (req, res) => {
  try {
    const accounts = await xero.listAccounts();
    res.json(accounts.map(a => ({ code: a.code, name: a.name })));
  } catch (err) {
    console.error('Xero list accounts failed:', err);
    res.status(502).json({ error: err.message || 'Failed to load Xero accounts' });
  }
});

router.get('/tax-rates', authenticate, requireRole('admin', 'office'), async (req, res) => {
  try {
    const rates = await xero.listTaxRates();
    res.json(rates.map(r => ({ taxType: r.taxType, name: r.name })));
  } catch (err) {
    console.error('Xero list tax rates failed:', err);
    res.status(502).json({ error: err.message || 'Failed to load Xero tax rates' });
  }
});

module.exports = router;
