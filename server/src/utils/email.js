const { Resend } = require('resend');
const pool = require('../db/pool');

async function getResendSettings() {
  // Env var takes priority
  if (process.env.RESEND_API_KEY) {
    return {
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM || 'noreply@dekkergroup.co.nz',
      fromName: process.env.EMAIL_FROM_NAME || 'Dekker Group',
    };
  }
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key='resend'`);
    if (rows[0]) return rows[0].value;
  } catch { /* ignore */ }
  return null;
}

async function sendMail({ to, subject, html, text, attachments }) {
  const s = await getResendSettings();
  if (!s?.apiKey) throw new Error('Email not configured — go to Settings → Email to add your Resend API key');

  const resend = new Resend(s.apiKey);
  const from = `${s.fromName || 'Dekker Group'} <${s.from}>`;

  const payload = { from, to, subject, html: html || text };
  if (attachments?.length) {
    payload.attachments = attachments.map(a => ({
      filename: a.filename,
      content: a.content, // Buffer
    }));
  }

  const { error } = await resend.emails.send(payload);
  if (error) throw new Error(error.message);
}

async function testConnection(apiKey) {
  const key = apiKey || (await getResendSettings())?.apiKey;
  if (!key) throw new Error('No API key configured');
  const resend = new Resend(key);
  // Verify key by hitting the domains list endpoint
  const { error } = await resend.domains.list();
  if (error) throw new Error(error.message);
}

module.exports = { sendMail, testConnection, getResendSettings };
