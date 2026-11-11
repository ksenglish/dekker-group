// The Job Form: offering it, printing it, and sending it.
const pool = require('../db/pool');
const jobPack = require('../services/jobPack');
const { getDefaultTheme } = require('../utils/documentThemes');
const { buildJobPackPDF } = require('../utils/jobPackPdf');
const { sendMail } = require('../utils/email');
const { appUrl } = require('../utils/appUrl');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = v => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const fileName = job =>
  [job.ref, 'Job Form'].filter(Boolean).join(' - ').replace(/[^\w.\- ]+/g, '_') + '.pdf';

// Whether the works list is wanted. It is off unless asked for: the form is
// about where the site is and what is agreed, and a list of everything on the
// quote is close enough to the quote itself that it should be a decision
// somebody makes, not a default.
const wantsWorks = v => v === true || v === '1' || v === 'true';

// What the panel needs to show before anybody commits to sending anything:
// what is in the pack, who it can go to, and when it last went out.
async function preview(req, res) {
  try {
    const data = await jobPack.gather(req.params.id);
    if (!data) return res.status(404).json({ error: 'Job not found' });
    const [people, sent] = await Promise.all([
      jobPack.recipients(),
      jobPack.lastSent(req.params.id),
    ]);
    res.json({
      job: {
        id: data.job.id, ref: data.job.ref, customer_name: data.job.customer_name,
        site_address: data.job.site_address || data.job.job_site_address,
      },
      has_accepted_quote: !!data.quote,
      accepted_count: data.quote?.accepted_count || 0,
      accepted_at: data.quote?.accepted_at || null,
      accepted_name: data.quote?.accepted_name || null,
      has_scope_text: !!data.quote?.notes,
      works_count: data.works.length,
      schedule_days: data.schedule_days,
      booking_count: data.schedule.length,
      team: data.team,
      attachments: data.attachments,
      recipients: people,
      last_sent: sent,
    });
  } catch (err) {
    console.error('[job form] preview failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

// Builds the document. Shared by the download and the email, so what lands in
// a subbie's inbox is byte-for-byte what the office saw when it checked.
async function build(jobId, { includeWorks, issuedBy, issuedTo, message }) {
  const data = await jobPack.gather(jobId);
  if (!data) return null;
  const [theme, files] = await Promise.all([
    getDefaultTheme(),
    jobPack.loadAttachmentFiles(jobId),
  ]);
  const pdf = await buildJobPackPDF({
    data,
    theme: theme || {},
    images: files.images,
    pdfs: files.pdfs,
    skipped: files.skipped,
    includeWorks,
    issuedBy,
    issuedTo,
    message,
  });
  return { pdf, data };
}

async function downloadPdf(req, res) {
  try {
    const built = await build(req.params.id, {
      includeWorks: wantsWorks(req.query.works),
      issuedBy: req.user?.name || '',
    });
    if (!built) return res.status(404).json({ error: 'Job not found' });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName(built.data.job).replace(/"/g, '')}"`,
    });
    res.send(built.pdf);
  } catch (err) {
    console.error('[job form] PDF generation failed:', err.message);
    res.status(500).json({ error: 'PDF generation failed' });
  }
}

// A booked day, written out. Built from the date parts in UTC: the server runs
// in UTC and 'YYYY-MM-DD' read as an instant is how a Tuesday becomes a Monday.
function dayLabel(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function emailBody({ job, data, message, senderName }) {
  const link = appUrl() ? `${appUrl()}/jobs/${job.id}` : null;
  const first = data.schedule_days[0];
  const when = first ? dayLabel(first.date) : null;

  const lines = [
    job.customer_name ? `Customer: ${job.customer_name}` : null,
    data.job.site_address || data.job.job_site_address
      ? `Site: ${data.job.site_address || data.job.job_site_address}` : null,
    when ? `First booked: ${when}` : 'Nothing booked in the diary yet',
  ].filter(Boolean);

  const subject = `Job Form — ${[job.ref, job.customer_name].filter(Boolean).join(' · ')}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;color:#0f172a;">
      <p style="margin:0 0 12px;">The job form for <strong>${escapeHtml(job.ref || 'this job')}</strong>
        is attached as a single PDF — site and customer details, the agreed scope,
        who is booked on which day, and every photo and plan held against the job.</p>
      ${message ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;white-space:pre-wrap;margin:0 0 12px;">${escapeHtml(message)}</div>` : ''}
      <ul style="margin:0 0 12px;padding-left:18px;">
        ${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}
      </ul>
      <p style="margin:0 0 12px;color:#64748b;font-size:13px;">Prices and terms of sale are
        not included in the attached form.</p>
      ${link ? `<p style="margin:16px 0 0;"><a href="${link}">Open this job in the app</a></p>` : ''}
      <p style="margin:16px 0 0;color:#64748b;font-size:13px;">Sent by ${escapeHtml(senderName || 'the office')}.</p>
    </div>`;
  const text = [
    `Job form for ${job.ref || 'this job'} attached.`,
    message || '',
    ...lines,
    'Prices and terms of sale are not included.',
    link || '',
  ].filter(Boolean).join('\n\n');
  return { subject, html, text };
}

async function email(req, res) {
  const to = String(req.body?.to || '').trim();
  const recipientName = String(req.body?.name || '').trim();
  const message = String(req.body?.message || '').trim();
  if (!EMAIL_RE.test(to)) {
    return res.status(400).json({ error: 'That does not look like an email address.' });
  }
  try {
    const built = await build(req.params.id, {
      includeWorks: wantsWorks(req.body?.works),
      issuedBy: req.user?.name || '',
      issuedTo: recipientName,
      message,
    });
    if (!built) return res.status(404).json({ error: 'Job not found' });

    const { data } = built;
    const job = { id: req.params.id, ref: data.job.ref, customer_name: data.job.customer_name };
    const { subject, html, text } = emailBody({
      job, data, message, senderName: req.user?.name,
    });

    await sendMail({
      to,
      subject,
      html,
      text,
      // So a question from the subbie comes back to the person who sent it
      // rather than into the no-reply address.
      replyTo: req.user?.email || undefined,
      attachments: [{ filename: fileName(data.job), content: built.pdf }],
    });

    // Logged against the job, so the panel can say when it last went out and
    // to whom — the question asked whenever a subbie says they never got it.
    await pool.query(
      `INSERT INTO email_log (job_id, type, recipient, status) VALUES ($1,'job_pack',$2,'sent')`,
      [req.params.id, to]
    );

    res.json({ message: `Job form sent to ${to}`, recipient: to });
  } catch (err) {
    console.error('[job form] send failed:', err.message);
    res.status(500).json({ error: err.message || 'Could not send the job form' });
  }
}

module.exports = { preview, downloadPdf, email };
