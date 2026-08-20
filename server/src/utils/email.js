const nodemailer = require('nodemailer');
const pool = require('../db/pool');

async function getEmailSettings() {
  // Env vars take priority
  if (process.env.SMTP_USER) {
    return {
      provider: 'smtp',
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '465'),
      secure: process.env.SMTP_SECURE !== 'false',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      fromName: process.env.EMAIL_FROM_NAME || 'Dekker Group',
    };
  }
  if (process.env.RESEND_API_KEY) {
    return {
      provider: 'resend',
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM || 'noreply@dekkergroup.co.nz',
      fromName: process.env.EMAIL_FROM_NAME || 'Dekker Group',
    };
  }
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key='email'`);
    if (rows[0]?.value) return rows[0].value;
    // Legacy: try old resend key
    const { rows: r2 } = await pool.query(`SELECT value FROM settings WHERE key='resend'`);
    if (r2[0]?.value) return { provider: 'resend', ...r2[0].value };
  } catch { /* ignore */ }
  return null;
}

// Legacy alias used by authController
const getResendSettings = getEmailSettings;

// Drops empties and duplicates from an address list, comparing case-insensitively
// so the same mailbox can't be listed twice in different casing.
function addressList(value) {
  const seen = new Set();
  const out = [];
  for (const raw of [].concat(value || [])) {
    const addr = String(raw || '').trim();
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

async function sendMail({ to, subject, html, text, attachments, bcc, replyTo }) {
  const s = await getEmailSettings();
  if (!s) throw new Error('Email not configured — go to Settings → Email to set up email sending.');

  const fromStr = `${s.fromName || 'Dekker Group'} <${s.from}>`;
  const bccList = addressList(bcc);
  const replyList = addressList(replyTo);

  if (s.provider === 'smtp') {
    const port = s.port || 587;
    const transporter = nodemailer.createTransport({
      host: s.host || 'smtp-relay.brevo.com',
      port,
      secure: port === 465, // true for SSL/465, false for STARTTLS/587
      auth: { user: s.user, pass: s.pass },
    });
    const payload = { from: fromStr, to, subject, html: html || text, text };
    if (bccList.length) payload.bcc = bccList;
    if (replyList.length) payload.replyTo = replyList.join(', ');
    if (attachments?.length) {
      payload.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
    }
    await transporter.sendMail(payload);
    return;
  }

  // Resend
  const { Resend } = require('resend');
  const resend = new Resend(s.apiKey);
  const payload = { from: fromStr, to, subject, html: html || text };
  if (bccList.length) payload.bcc = bccList;
  if (replyList.length) payload.replyTo = replyList;
  if (attachments?.length) {
    payload.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
  }
  const { error } = await resend.emails.send(payload);
  if (error) throw new Error(error.message);
}

async function testConnection(settings) {
  const s = settings || await getEmailSettings();
  if (!s) throw new Error('No email configuration found');

  if (s.provider === 'smtp') {
    const port = s.port || 587;
    const transporter = nodemailer.createTransport({
      host: s.host || 'smtp-relay.brevo.com',
      port,
      secure: port === 465,
      auth: { user: s.user, pass: s.pass },
    });
    await transporter.verify();
    return;
  }

  const { Resend } = require('resend');
  const resend = new Resend(s.apiKey);
  const { error } = await resend.domains.list();
  if (error) throw new Error(error.message);
}

module.exports = { sendMail, testConnection, getResendSettings, getEmailSettings };
