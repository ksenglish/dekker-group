const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db/pool');
const { signAccessToken, signRefreshToken, verifyRefreshToken, signOtpToken, verifyOtpToken } = require('../utils/jwt');
const { sendMail, getResendSettings, getEmailSettings } = require('../utils/email');

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// ── Rate limiting ─────────────────────────────────────────────────────────────

async function countRecentFailures(identifier) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM login_attempts
     WHERE identifier = $1 AND attempted_at > NOW() - INTERVAL '${LOCKOUT_MINUTES} minutes'`,
    [identifier]
  );
  return parseInt(rows[0].count, 10);
}

async function recordFailure(identifier) {
  await pool.query('INSERT INTO login_attempts (identifier) VALUES ($1)', [identifier]);
}

async function clearFailures(identifier) {
  await pool.query('DELETE FROM login_attempts WHERE identifier = $1', [identifier]);
}

// ── Audit log ─────────────────────────────────────────────────────────────────

async function auditLog(userId, email, ip, ua, status) {
  try {
    await pool.query(
      'INSERT INTO login_audit (user_id, email, ip_address, user_agent, status) VALUES ($1, $2, $3, $4, $5)',
      [userId || null, email || null, ip, (ua || '').substring(0, 500), status]
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// ── OTP helpers ───────────────────────────────────────────────────────────────

function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

async function sendOtpEmail(toEmail, toName, code) {
  await sendMail({
    to: toEmail,
    subject: `${code} — your Dekker App sign-in code`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
        <div style="margin-bottom:24px;">
          <strong style="font-size:20px;color:#0f172a;">Dekker App</strong>
        </div>
        <h2 style="font-size:22px;font-weight:700;color:#0f172a;margin:0 0 8px;">Your sign-in code</h2>
        <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 28px;">
          Hi ${toName}, use the code below to complete your sign-in. It expires in 10 minutes.
        </p>
        <div style="background:#f1f5f9;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
          <span style="font-size:44px;font-weight:800;letter-spacing:14px;color:#0f172a;font-family:monospace;">${code}</span>
        </div>
        <p style="color:#94a3b8;font-size:13px;line-height:1.6;">
          If you didn't try to sign in to Dekker App, please contact your administrator immediately.
        </p>
      </div>
    `,
  });
}

// ── Issue tokens and complete the login ───────────────────────────────────────

async function completeLogin(user, res) {
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
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, licence_number: user.licence_number, mobile: user.mobile, default_billing_rate_id: user.default_billing_rate_id } });
}

// ── Auth handlers ─────────────────────────────────────────────────────────────

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const normalEmail = email.toLowerCase().trim();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const ua = req.headers['user-agent'] || '';

  try {
    // Rate limit check per email
    const failures = await countRecentFailures(normalEmail);
    if (failures >= MAX_ATTEMPTS) {
      await auditLog(null, normalEmail, ip, ua, 'locked');
      return res.status(429).json({
        error: `Account temporarily locked after too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
      });
    }

    const { rows } = await pool.query(
      'SELECT id, name, email, password_hash, role, licence_number, mobile, default_billing_rate_id, COALESCE(is_active, true) AS is_active FROM users WHERE email = $1',
      [normalEmail]
    );
    const user = rows[0];

    if (!user || !user.is_active) {
      await recordFailure(normalEmail);
      await auditLog(null, normalEmail, ip, ua, 'failed_password');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await recordFailure(normalEmail);
      await auditLog(user.id, normalEmail, ip, ua, 'failed_password');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Skip 2FA if email is not configured or explicitly bypassed (dev/emergency)
    const emailSettings = await getEmailSettings().catch(() => null);
    if (!emailSettings || process.env.SKIP_2FA === 'true') {
      await clearFailures(normalEmail);
      await auditLog(user.id, normalEmail, ip, ua, 'success');
      return completeLogin(user, res);
    }

    // Generate and send OTP
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('DELETE FROM login_otps WHERE user_id = $1', [user.id]);
    await pool.query(
      'INSERT INTO login_otps (user_id, code_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, hashCode(code), expiresAt]
    );

    await sendOtpEmail(user.email, user.name, code);

    // Return a short-lived token proving password was verified (no data access yet)
    res.json({ requires_otp: true, otp_token: signOtpToken(user.id, user.email) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function verifyOtp(req, res) {
  const { otp_token, code } = req.body;
  if (!otp_token || !code) return res.status(400).json({ error: 'Missing token or code' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const ua = req.headers['user-agent'] || '';

  try {
    let decoded;
    try {
      decoded = verifyOtpToken(otp_token);
    } catch {
      return res.status(401).json({ error: 'Session expired — please sign in again.', force_restart: true });
    }

    const { id: userId, email: userEmail } = decoded;

    // Check OTP attempt rate limit
    const otpFailures = await countRecentFailures(`otp:${userId}`);
    if (otpFailures >= MAX_ATTEMPTS) {
      await auditLog(userId, userEmail, ip, ua, 'locked');
      return res.status(429).json({ error: 'Too many incorrect codes — please sign in again.', force_restart: true });
    }

    const codeHash = hashCode(code.trim());
    const { rows } = await pool.query(
      'SELECT id FROM login_otps WHERE user_id=$1 AND code_hash=$2 AND expires_at > NOW() AND used=false',
      [userId, codeHash]
    );

    if (!rows[0]) {
      await recordFailure(`otp:${userId}`);
      await auditLog(userId, userEmail, ip, ua, 'failed_otp');
      const remaining = MAX_ATTEMPTS - (otpFailures + 1);
      if (remaining <= 0) {
        return res.status(429).json({ error: 'Too many incorrect codes — please sign in again.', force_restart: true });
      }
      return res.status(401).json({
        error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
      });
    }

    // Mark used, clear failures, tidy old OTPs
    await pool.query('UPDATE login_otps SET used=true WHERE id=$1', [rows[0].id]);
    await clearFailures(userEmail);
    await clearFailures(`otp:${userId}`);
    await pool.query('DELETE FROM login_otps WHERE expires_at < NOW()').catch(() => {});

    const userResult = await pool.query('SELECT id, name, email, role, licence_number, mobile, default_billing_rate_id FROM users WHERE id=$1', [userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });

    await auditLog(userId, user.email, ip, ua, 'success');
    await completeLogin(user, res);
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function resendOtp(req, res) {
  const { otp_token } = req.body;
  if (!otp_token) return res.status(400).json({ error: 'Missing token' });

  try {
    let decoded;
    try {
      decoded = verifyOtpToken(otp_token);
    } catch {
      return res.status(401).json({ error: 'Session expired — please sign in again.', force_restart: true });
    }

    const { id: userId } = decoded;
    const userResult = await pool.query('SELECT id, name, email FROM users WHERE id=$1', [userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('DELETE FROM login_otps WHERE user_id = $1', [userId]);
    await pool.query(
      'INSERT INTO login_otps (user_id, code_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, hashCode(code), expiresAt]
    );

    await sendOtpEmail(user.email, user.name, code);

    res.json({ otp_token: signOtpToken(userId, user.email) });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getLoginHistory(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT status, ip_address, user_agent, created_at
       FROM login_audit WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json(rows);
  } catch {
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
    const userResult = await pool.query('SELECT id, name, email, role, licence_number, mobile, default_billing_rate_id FROM users WHERE id = $1', [decoded.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role, name: user.name });
    res.json({ accessToken, user });
  } catch (err) {
    console.error('refresh error:', err.message);
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
    const { rows } = await pool.query('SELECT id, name, email, role, licence_number, mobile, default_billing_rate_id, created_at FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
}

// Shared helper — generate & store token, send email
async function sendResetEmail({ userId, userEmail, userName, subject, bodyHeading, bodyText, buttonLabel }) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 48 * 60 * 60 * 1000);
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
      'UPDATE users SET password_hash=$1, invite_token=NULL, invite_token_expires=NULL WHERE id=$2',
      [hash, rows[0].id]
    );
    res.json({ message: 'Password set. You can now log in.' });
  } catch (err) {
    console.error('setPassword error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  try {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
    res.json({ message: 'Password updated.' });
  } catch { res.status(500).json({ error: 'Server error' }); }
}

module.exports = {
  login, verifyOtp, resendOtp, getLoginHistory,
  refresh, logout, me,
  forgotPassword, checkResetToken, setPassword, sendResetEmail, changePassword,
};
