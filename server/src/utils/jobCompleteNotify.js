const pool = require('../db/pool');
const { sendMail } = require('./email');
const { OFFICE_RECORDS_EMAIL } = require('./recordsEmail');
const { resolveOfficeUsers } = require('./jobNoteNotify');
const { getStatusConfig, findStatusByLabel, normaliseLabel } = require('./jobStatusFlow');

const appUrl = () => (process.env.CLIENT_URL || '').replace(/\/$/, '');

const escapeHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function jobLabel(job) {
  if (!job) return 'Job';
  if (job.external_ref) return job.external_ref;
  if (job.job_number != null) return 'JB' + String(job.job_number).padStart(5, '0');
  return 'Job';
}

// Which status means "the work is finished, invoice it".
//
// Not the 'complete' key. That key ships with the pipeline but the list is
// admin-configurable, and here it has been relabelled "Paid" — so firing on the
// key sent the office a job-is-ready-to-invoice email at the moment the job was
// paid for, which is the last moment it is useful.
//
// The label is what the office actually reads and what they renamed, so the
// label is what this matches: any status reading "Job Complete", "Complete",
// "Completed", "Work Complete". The key is only a fallback, for a pipeline with
// no such label at all.
const readsAsComplete = l => /\bcomplete(d)?\b/.test(l);

async function completeStatusKey() {
  const config = await getStatusConfig();
  const match = findStatusByLabel(config, readsAsComplete);
  if (match) return match.key;
  // No status says "complete" anywhere. Fall back to the shipped key, but only
  // if nothing has taken that key over with a different meaning.
  const shipped = config.find(s => s.key === 'complete');
  return shipped && !readsAsComplete(normaliseLabel(shipped.label)) ? null : 'complete';
}

async function completeStatusLabel() {
  const match = findStatusByLabel(await getStatusConfig(), readsAsComplete);
  // With no configured list the fallback config carries the key as its label,
  // which would put "marked complete" in lower case in front of a customer-
  // facing mailbox. Only a label someone actually typed is used as typed.
  if (!match || match.label === match.key) return 'Complete';
  return match.label;
}

async function isCompleteStatus(status) {
  if (!status) return false;
  return status === await completeStatusKey();
}

function completeEmail({ job, actorName, statusLabel = 'Complete' }) {
  const label = jobLabel(job);
  const link = appUrl() ? `${appUrl()}/jobs/${job.id}` : null;
  const address = job.site_address_full || '';
  // What the office is being asked to do, not what changed — this lands in a
  // shared mailbox where the subject is the whole of what gets read.
  const subject = `${label} ready to invoice${job.customer_name ? ` — ${job.customer_name}` : ''}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;">
      <p style="margin:0 0 12px;"><strong>${escapeHtml(label)}</strong>${job.customer_name ? ` for <strong>${escapeHtml(job.customer_name)}</strong>` : ''} has been marked <strong>${escapeHtml(statusLabel)}</strong>${actorName ? ` by ${escapeHtml(actorName)}` : ''}.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;color:#0f172a;margin:0 0 12px;">
        ${job.customer_name ? `<tr><td style="padding:2px 12px 2px 0;color:#64748b;">Customer</td><td style="padding:2px 0;">${escapeHtml(job.customer_name)}</td></tr>` : ''}
        ${address ? `<tr><td style="padding:2px 12px 2px 0;color:#64748b;">Site</td><td style="padding:2px 0;">${escapeHtml(address)}</td></tr>` : ''}
        ${job.type ? `<tr><td style="padding:2px 12px 2px 0;color:#64748b;">Job type</td><td style="padding:2px 0;">${escapeHtml(job.type)}</td></tr>` : ''}
      </table>
      <p style="margin:0 0 12px;color:#0f172a;font-size:14px;"><strong>Ready to invoice.</strong></p>
      ${link ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
        <tr><td style="background:#0f172a;border-radius:6px;">
          <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Open ${escapeHtml(label)}</a>
        </td></tr></table>` : ''}
    </div>`;
  const text = [
    `${label}${job.customer_name ? ` for ${job.customer_name}` : ''} has been marked ${statusLabel}${actorName ? ` by ${actorName}` : ''}.`,
    address ? `Site: ${address}` : '',
    job.type ? `Job type: ${job.type}` : '',
    'Ready to invoice.',
    link || '',
  ].filter(Boolean).join('\n\n');
  return { subject, html, text };
}

// Claims the job, so only one of the several paths that can complete a job
// gets to announce it. Returns the job if this caller won the claim, else null.
async function claimJob(jobId) {
  const { rows } = await pool.query(
    `UPDATE jobs SET complete_notified_at = NOW()
      WHERE id = $1 AND complete_notified_at IS NULL
      RETURNING id, job_number, external_ref, type, customer_id, site_id, site_address`,
    [jobId]
  );
  if (!rows[0]) return null;
  const { rows: [detail] } = await pool.query(
    `SELECT c.name AS customer_name, COALESCE(s.address, j.site_address) AS site_address_full
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN customer_sites s ON s.id = j.site_id
      WHERE j.id = $1`,
    [jobId]
  );
  return { ...rows[0], ...detail };
}

// Tells the office a job is finished: an email to the office mailbox, and the
// same thing on their To-Do List — the two halves of what a tagged job note
// already does, so completions land where the office is already looking.
//
// Best-effort throughout. The status change is already saved, and a mail server
// being down must not turn it into an error the user has to retry.
async function notifyJobComplete({ jobId, actor }) {
  const result = { emailed: [], todo_id: null, assigned: [], errors: [] };
  if (!jobId) return result;

  let job;
  try {
    job = await claimJob(jobId);
  } catch (err) {
    console.error('[job complete] could not claim the job:', err.message);
    return result;
  }
  // Already announced — a second path reaching Complete says nothing.
  if (!job) return result;

  const statusLabel = await completeStatusLabel();
  const { subject, html, text } = completeEmail({ job, actorName: actor?.name, statusLabel });

  let officeUsers = [];
  try {
    officeUsers = await resolveOfficeUsers();
  } catch (err) {
    console.error('[job complete] could not resolve the office:', err.message);
  }

  // The office mailbox itself is always written to — that is where the office
  // actually reads, whether or not a user account carries the address. Anyone
  // whose account backs it is added, in case they read their own inbox.
  const addresses = new Set([OFFICE_RECORDS_EMAIL.toLowerCase()]);
  officeUsers.forEach(u => { if (u.email) addresses.add(u.email.toLowerCase()); });
  // Whoever completed the job knows they did — no need to mail them, unless
  // they *are* the office, in which case the shared inbox still gets its copy.
  if (actor?.email && actor.email.toLowerCase() !== OFFICE_RECORDS_EMAIL.toLowerCase()) {
    addresses.delete(actor.email.toLowerCase());
  }

  for (const to of addresses) {
    try {
      await sendMail({ to, subject, html, text });
      result.emailed.push(to);
    } catch (err) {
      console.error(`[job complete] email to ${to} failed:`, err.message);
      result.errors.push(`email to ${to} failed`);
    }
  }

  // The to-do needs a real user to sit with. If no account backs the office
  // mailbox the email still goes; there is simply no list to put it on.
  const assignees = officeUsers.map(u => u.id).filter(Boolean);
  if (!assignees.length) return result;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const label = jobLabel(job);
    const { rows: [todo] } = await client.query(
      `INSERT INTO todos (description, notes, job_id, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [
        `${label} ready to invoice${job.customer_name ? ` — ${job.customer_name}` : ''}`,
        [
          `Marked ${statusLabel}${actor?.name ? ` by ${actor.name}` : ''}.`,
          job.site_address_full ? `Site: ${job.site_address_full}` : '',
          'Ready to invoice.',
        ].filter(Boolean).join('\n'),
        job.id,
        // Raised by whoever completed it where that is known, so the list shows
        // who it came from. Falls back to the office themselves for automatic
        // completions, which have no person behind them.
        actor?.id || assignees[0],
      ]
    );
    for (const uid of assignees) {
      await client.query(
        `INSERT INTO todo_assignees (todo_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [todo.id, uid]
      );
    }
    await client.query('COMMIT');
    result.todo_id = todo.id;
    result.assigned = officeUsers.map(u => u.name).filter(Boolean);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[job complete] to-do creation failed:', err.message);
    result.errors.push('could not add it to the to-do list');
  } finally {
    client.release();
  }

  return result;
}

// The single entry point every path that writes a job status calls. Completing
// announces it once; moving off Complete clears the claim, so a job reopened
// and finished again is announced again.
async function onJobStatusChanged({ jobId, status, actor }) {
  if (!jobId) return null;
  try {
    if (await isCompleteStatus(status)) return await notifyJobComplete({ jobId, actor });
    await pool.query(
      'UPDATE jobs SET complete_notified_at = NULL WHERE id = $1 AND complete_notified_at IS NOT NULL',
      [jobId]
    );
  } catch (err) {
    console.error('[job complete] status change handling failed:', err.message);
  }
  return null;
}

module.exports = { notifyJobComplete, onJobStatusChanged, isCompleteStatus, completeStatusKey };
