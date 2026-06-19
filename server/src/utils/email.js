const nodemailer = require('nodemailer');

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendMail({ to, subject, html, attachments }) {
  const transport = getTransport();
  if (!transport) throw new Error('Email not configured — set SMTP_HOST in .env');
  await transport.sendMail({
    from: `"Dekker Group" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
    attachments,
  });
}

module.exports = { sendMail };
