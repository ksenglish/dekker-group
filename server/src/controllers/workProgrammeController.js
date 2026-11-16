// The Work Programme: composing one, printing it, sharing it and sending it.
//
// A share is one person's copy — its own link, its own choice of pre-install
// files and its own choice of bookings. The link is live, the way the service
// report's is: editing the share changes what its recipient sees next time
// they open it, rather than producing a second link competing with the first.
const pool = require('../db/pool');
const workProgramme = require('../services/workProgramme');
const { buildWorkProgrammePDF } = require('../utils/workProgrammePdf');
const { sendMail } = require('../utils/email');
const { appUrl } = require('../utils/appUrl');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = v => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const fileName = report =>
  [report.job.number, 'Work Programme'].filter(Boolean).join(' - ').replace(/[^\w.\- ]+/g, '_') + '.pdf';

// A date the way the email writes one. Built from the parts in UTC: the server
// runs in UTC and 'YYYY-MM-DD' read as an instant is how a Tuesday becomes a
// Monday.
function dayLabel(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

// ── The office's view ────────────────────────────────────────────────────────

// Everything the office picks from — the whole job, not one person's copy —
// plus who it can go to and the shares already out there.
async function preview(req, res) {
  try {
    const report = await workProgramme.buildPicker(req.params.id);
    if (!report) return res.status(404).json({ error: 'Job not found' });
    const [people, shares] = await Promise.all([
      workProgramme.recipients(),
      workProgramme.listShares(req.params.id),
    ]);
    // The theme carries the logo, which is a large string the page already has
    // in `company`. Stripped for the same reason the service report strips it.
    const { _theme, ...body } = report;
    res.json({ ...body, recipients: people, shares });
  } catch (err) {
    console.error('[work programme] preview failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

// The report as one share's recipient sees it. Also what the office previews
// when it opens an existing share.
async function shareReport(jobId, share) {
  const report = await workProgramme.buildReport(jobId, workProgramme.selectionOf(share));
  if (!report) return null;
  return {
    ...report,
    prepared_for: share?.recipient_name || share?.recipient_email || '',
    message: share?.message || '',
    share_id: share?.id || null,
  };
}

async function build(jobId, share) {
  const report = await shareReport(jobId, share);
  if (!report) return null;
  const files = await workProgramme.loadFileBytes(report.files);
  const pdf = await buildWorkProgrammePDF({
    report,
    images: files.images,
    pdfs: files.pdfs,
    skipped: files.skipped,
  });
  return { pdf, report };
}

// ── Shares ───────────────────────────────────────────────────────────────────

async function listShares(req, res) {
  try {
    res.json(await workProgramme.listShares(req.params.id));
  } catch (err) {
    console.error('[work programme]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

async function createShare(req, res) {
  const email = String(req.body?.recipient_email || '').trim();
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'That does not look like an email address.' });
  }
  try {
    const { rows } = await pool.query('SELECT 1 FROM jobs WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Job not found' });
    const share = await workProgramme.createShare(
      req.params.id, { ...req.body, recipient_email: email || null }, req.user.id
    );
    res.status(201).json(share);
  } catch (err) {
    console.error('[work programme] could not create a share:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateShare(req, res) {
  const email = req.body?.recipient_email;
  if (email && !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'That does not look like an email address.' });
  }
  try {
    const share = await workProgramme.updateShare(req.params.id, req.params.shareId, req.body || {});
    if (!share) return res.status(404).json({ error: 'That link no longer exists' });
    res.json(share);
  } catch (err) {
    console.error('[work programme] could not update a share:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

async function revokeShare(req, res) {
  try {
    const ok = await workProgramme.revokeShare(req.params.id, req.params.shareId);
    if (!ok) return res.status(404).json({ error: 'That link no longer exists' });
    res.json({ message: 'The link has been stopped' });
  } catch (err) {
    console.error('[work programme]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

// One share's copy, as the office previews it before sending.
async function getSharePreview(req, res) {
  try {
    const share = await workProgramme.getShare(req.params.id, req.params.shareId);
    if (!share) return res.status(404).json({ error: 'That link no longer exists' });
    const report = await shareReport(req.params.id, share);
    if (!report) return res.status(404).json({ error: 'Job not found' });
    const { _theme, ...body } = report;
    res.json({ ...body, share });
  } catch (err) {
    console.error('[work programme]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── The PDF ──────────────────────────────────────────────────────────────────

// ?share=<id> prints that person's copy; without it, the whole job.
async function downloadPdf(req, res) {
  try {
    const share = req.query.share
      ? await workProgramme.getShare(req.params.id, req.query.share)
      : null;
    if (req.query.share && !share) {
      return res.status(404).json({ error: 'That link no longer exists' });
    }
    const built = await build(req.params.id, share);
    if (!built) return res.status(404).json({ error: 'Job not found' });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName(built.report).replace(/"/g, '')}"`,
    });
    res.send(built.pdf);
  } catch (err) {
    console.error('[work programme] PDF generation failed:', err.message);
    res.status(500).json({ error: 'PDF generation failed' });
  }
}

// ── Sending it ───────────────────────────────────────────────────────────────

function emailBody({ report, share, senderName, link }) {
  const first = report.schedule[0];
  const when = first ? dayLabel(first.date) : null;
  const lines = [
    report.customer.name ? `Customer: ${report.customer.name}` : null,
    report.job.address ? `Site: ${report.job.address}` : null,
    when ? `First booked: ${when}` : 'No days from the diary are on this copy',
  ].filter(Boolean);

  const subject = `Work Programme - ${[report.job.number, report.customer.name].filter(Boolean).join(' · ')}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;color:#0f172a;">
      <p style="margin:0 0 12px;">The work programme for
        <strong>${escapeHtml(report.job.number || 'this job')}</strong> is ready.
        It has the site and customer details, the agreed scope, the photos and plans
        for the job, and the days you are booked on.</p>
      ${share.message ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;white-space:pre-wrap;margin:0 0 12px;">${escapeHtml(share.message)}</div>` : ''}
      <p style="margin:0 0 18px;">
        <a href="${link}" style="display:inline-block;background:${report.company?.brandColour || '#1e40af'};color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:7px;font-weight:600;">Open the work programme</a>
      </p>
      <p style="margin:0 0 12px;color:#64748b;font-size:13px;">The page stays up to date as the
        job changes, and there is a Download PDF button on it. A copy is attached to this
        email as well.</p>
      <ul style="margin:0 0 12px;padding-left:18px;">
        ${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}
      </ul>
      <p style="margin:0 0 12px;color:#64748b;font-size:13px;">Prices and terms of sale are
        not part of this programme.</p>
      <p style="margin:16px 0 0;color:#64748b;font-size:13px;">Sent by ${escapeHtml(senderName || 'the office')}.</p>
    </div>`;
  const text = [
    `Work programme for ${report.job.number || 'this job'}.`,
    share.message || '',
    `Open it here: ${link}`,
    'A PDF copy is attached.',
    ...lines,
    'Prices and terms of sale are not part of this programme.',
  ].filter(Boolean).join('\n\n');
  return { subject, html, text };
}

async function email(req, res) {
  try {
    const share = await workProgramme.getShare(req.params.id, req.params.shareId);
    if (!share) return res.status(404).json({ error: 'That link no longer exists' });
    // The address can be given on the send, for a link made before anybody
    // decided who it was for.
    const to = String(req.body?.to || share.recipient_email || '').trim();
    if (!EMAIL_RE.test(to)) {
      return res.status(400).json({ error: 'That does not look like an email address.' });
    }

    const built = await build(req.params.id, share);
    if (!built) return res.status(404).json({ error: 'Job not found' });

    const base = appUrl();
    const link = base ? `${base}${share.path}` : share.path;
    const { subject, html, text } = emailBody({
      report: built.report, share, senderName: req.user?.name, link,
    });

    await sendMail({
      to,
      subject,
      html,
      text,
      // So a question from the subbie comes back to the person who sent it
      // rather than into the no-reply address.
      replyTo: req.user?.email || undefined,
      attachments: [{ filename: fileName(built.report), content: built.pdf }],
    });

    await workProgramme.markSent(share.id);
    // Logged against the job, so the office can see who has actually had it —
    // the question asked whenever a subbie says they never got it.
    await pool.query(
      `INSERT INTO email_log (job_id, type, recipient, status) VALUES ($1,'work_programme',$2,'sent')`,
      [req.params.id, to]
    );

    res.json({ message: `Work programme sent to ${to}`, recipient: to, link });
  } catch (err) {
    console.error('[work programme] send failed:', err.message);
    res.status(500).json({ error: err.message || 'Could not send the work programme' });
  }
}

// ── The recipient's copy ─────────────────────────────────────────────────────

// The same 404 whether the link never existed or has been revoked — there is
// nothing to be learned by guessing tokens.
const GONE = { error: 'This work programme is no longer available' };

async function publicGet(req, res) {
  try {
    const share = await workProgramme.shareByToken(req.params.token);
    if (!share) return res.status(404).json(GONE);
    const report = await shareReport(share.job_id, share);
    if (!report) return res.status(404).json(GONE);
    // No theme (the logo is already in `company`), no job id, and nothing
    // about who else the work programme went to.
    const { _theme, share_id, ...body } = report;
    res.json({ ...body, job: { ...body.job, id: undefined } });
  } catch (err) {
    console.error('[work programme] public read failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

async function publicPdf(req, res) {
  try {
    const share = await workProgramme.shareByToken(req.params.token);
    if (!share) return res.status(404).json(GONE);
    const built = await build(share.job_id, share);
    if (!built) return res.status(404).json(GONE);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName(built.report).replace(/"/g, '')}"`,
    });
    res.send(built.pdf);
  } catch (err) {
    console.error('[work programme] public PDF failed:', err.message);
    res.status(500).json({ error: 'PDF generation failed' });
  }
}

// One photo or plan, for the page to show. The token only ever reaches files
// on its own job, and only the ones that share actually carries — a file taken
// off somebody's copy must not still be fetchable by guessing its id.
async function publicFile(req, res) {
  try {
    const share = await workProgramme.shareByToken(req.params.token);
    if (!share) return res.status(404).json(GONE);
    if (Array.isArray(share.attachment_ids)
        && !share.attachment_ids.map(String).includes(String(req.params.attachmentId))) {
      return res.status(404).json(GONE);
    }
    const file = await workProgramme.readFile(share.job_id, req.params.attachmentId);
    if (!file) return res.status(404).json(GONE);
    res.set('Content-Type', file.mime || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${String(file.filename).replace(/"/g, '')}"`);
    res.set('Cache-Control', 'private, max-age=600');
    res.send(file.buffer);
  } catch (err) {
    console.error('[work programme] public file failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

// The office's own view of a file, which goes through the ordinary
// authenticated attachment route — this is only here so one component can ask
// for a file the same way on both pages.
module.exports = {
  preview, listShares, createShare, updateShare, revokeShare, getSharePreview,
  downloadPdf, email, publicGet, publicPdf, publicFile,
};
