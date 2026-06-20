const nodemailer = require('nodemailer');
const pool = require('../db/pool');

async function getSmtpSettings() {
  // Env vars take priority over DB settings
  if (process.env.SMTP_HOST) {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.EMAIL_FROM,
      fromName: process.env.EMAIL_FROM_NAME || 'Dekker Group',
    };
  }
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key='smtp'`);
    if (rows[0]) return rows[0].value;
  } catch { /* ignore */ }
  return null;
}

async function getTransport() {
  const s = await getSmtpSettings();
  if (!s?.host) return null;
  return nodemailer.createTransport({
    host: s.host,
    port: s.port || 587,
    secure: !!s.secure,
    auth: { user: s.user, pass: s.pass },
  });
}

async function sendMail({ to, subject, html, attachments }) {
  const s = await getSmtpSettings();
  if (!s?.host) throw new Error('Email not configured — go to Settings → Email to set up SMTP');
  const transport = await getTransport();
  await transport.sendMail({
    from: `"${s.fromName || 'Dekker Group'}" <${s.from || s.user}>`,
    to, subject, html, attachments,
  });
}

async function testConnection() {
  const transport = await getTransport();
  if (!transport) throw new Error('No SMTP settings configured');
  await transport.verify();
}

module.exports = { sendMail, testConnection, getSmtpSettings };
