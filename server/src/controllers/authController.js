const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db/pool');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { sendMail, getResendSettings } = require('../utils/email');

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, password_hash, role, COALESCE(is_active, true) AS is_active FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken({ id: user.id });
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function refresh(req, res) {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ error: 'No refresh token' });
  try {
    const decoded = verifyRefreshToken(token);
    const { rows } = await pool.query(
      'SELECT id FROM refresh_tokens WHERE token = $1 AND user_id = $2 AND expires_at > NOW()',
      [token, decoded.id]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid refresh token' });
    const userResult = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [decoded.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role, name: user.name });
    res.json({ accessToken, user });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
}

async function logout(req, res) {
  const token = req.cookies?.refreshToken;
  if (token) await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [token]).catch(() => {});
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out' });
}

async function me(req, res) {
  try {
    const { rows } = await pool.query('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
}

// Shared helper — generate & store token, send email
async function sendResetEmail({ userId, userEmail, userName, subject, bodyHeading, bodyText, buttonLabel }) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
  await pool.query(
    'UPDATE users SET invite_token=$1, invite_token_expires=$2 WHERE id=$3',
    [token, expires, userId]
  );

  const appUrl = process.env.APP_URL || 'https://dekker-group.onrender.com';
  const link = `${appUrl}/set-password/${token}`;

  const settings = await getResendSettings();
  const companyName = 'Dekker App';

  await sendMail({
    to: userEmail,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
        <div style="margin-bottom:24px;">
          <strong style="font-size:20px;color:#0f172a;">${companyName}</strong>
        </div>
        <h2 style="font-size:22px;font-weight:700;color:#0f172a;margin-bottom:8px;">${bodyHeading}</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;margin-bottom:28px;">${bodyText}</p>
        <a href="${link}" style="display:inline-block;background:#1e40af;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">${buttonLabel}</a>
        <p style="color:#94a3b8;font-size:12px;margin-top:32px;">This link expires in 48 hours. If you didn't expect this email, you can ignore it.</p>
        <p style="color:#94a3b8;font-size:12px;">Or copy this link: ${link}</p>
      </div>
    `,
  });

  return token;
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  // Always return success to prevent email enumeration
  res.json({ message: 'If that email exists, a reset link has been sent.' });
  if (!email) return;
  try {
    const { rows } = await pool.query('SELECT id, name, email FROM users WHERE email=$1 AND is_active=true', [email.toLowerCase().trim()]);
    if (!rows[0]) return;
    await sendResetEmail({
      userId: rows[0].id, userEmail: rows[0].email, userName: rows[0].name,
      subject: 'Reset your Dekker App password',
      bodyHeading: 'Reset your password',
      bodyText: `Hi ${rows[0].name},<br><br>We received a request to reset your password. Click the button below to choose a new one.`,
      buttonLabel: 'Reset Password',
    });
  } catch (err) { console.error('forgot-password error:', err); }
}

// Validate token (client checks before showing form)
async function checkResetToken(req, res) {
  const { token } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email FROM users WHERE invite_token=$1 AND invite_token_expires > NOW()',
      [token]
    );
    if (!rows[0]) return res.status(400).json({ error: 'This link has expired or is invalid.' });
    res.json({ name: rows[0].name, email: rows[0].email });
  } catch { res.status(500).json({ error: 'Server error' }); }
}

// Set new password via token
async function setPassword(req, res) {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    const { rows } = await pool.query(
      'SELECT id FROM users WHERE invite_token=$1 AND invite_token_expires > NOW()',
      [token]
    );
    if (!rows[0]) return res.status(400).json({ error: 'This link has expired or is invalid.' });
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      'UPDATE users SET password_hash=$1, invite_token=NULL, invite_token_expires=NULL, is_active=true WHERE id=$2',
      [hash, rows[0].id]
    );
    res.json({ message: 'Password set. You can now log in.' });
  } catch { res.status(500).json({ error: 'Server error' }); }
}

module.exports = { login, refresh, logout, me, forgotPassword, checkResetToken, setPassword, sendResetEmail };
