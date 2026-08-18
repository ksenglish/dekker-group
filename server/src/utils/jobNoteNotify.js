const pool = require('../db/pool');
const { sendMail } = require('./email');
const { OFFICE_RECORDS_EMAIL } = require('./recordsEmail');

const appUrl = () => (process.env.CLIENT_URL || '').replace(/\/$/, '');

const escapeHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function jobLabel(job) {
  if (!job) return '';
  if (job.external_ref) return job.external_ref;
  if (job.job_number != null) return 'JB' + String(job.job_number).padStart(5, '0');
  return 'Job';
}

// "Office" is a mailbox, not a role — whoever watches it may well hold an admin
// account. Resolve it to real users so the to-do lands on someone's list, and
// fall back to the office role only if no account uses that address.
async function resolveOfficeUsers() {
  const { rows: byEmail } = await pool.query(
    `SELECT id, name, email FROM users WHERE LOWER(email) = LOWER($1)`,
    [OFFICE_RECORDS_EMAIL]
  );
  if (byEmail.length) return byEmail;
  const { rows: byRole } = await pool.query(
    `SELECT id, name, email FROM users WHERE role = 'office'`
  );
  return byRole;
}

// Who the Notify controls will actually reach, so the note form can say so
// rather than leaving the user guessing whether "Office" goes anywhere.
async function notifyTargets() {
  const office = await resolveOfficeUsers();
  return {
    office_email: OFFICE_RECORDS_EMAIL,
    office_users: office.map(u => ({ id: u.id, name: u.name })),
  };
}

function noteEmail({ job, note, authorName, customerName }) {
  const label = jobLabel(job);
  const link = appUrl() ? `${appUrl()}/jobs/${job.id}` : null;
  const subject = `Note on ${label}${customerName ? ` — ${customerName}` : ''}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;">
      <p style="margin:0 0 12px;"><strong>${escapeHtml(authorName)}</strong> added a note to
        <strong>${escapeHtml(label)}</strong>${customerName ? ` for ${escapeHtml(customerName)}` : ''}.</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;white-space:pre-wrap;">${escapeHtml(note.content)}</div>
      ${link ? `<p style="margin:20px 0 0;"><a href="${link}">Open ${escapeHtml(label)}</a></p>` : ''}
    </div>`;
  const text = `${authorName} added a note to ${label}${customerName ? ` for ${customerName}` : ''}.\n\n${note.content}${link ? `\n\n${link}` : ''}`;
  return { subject, html, text };
}

// Emails the chosen people and puts the note on their To-Do List.
//
// Everything here is best-effort: the note itself is already saved, and a mail
// server being down must not turn a saved note into an error the user has to
// retry. Failures are logged and reported back in the result instead.
async function notifyJobNote({ jobId, note, author, notifyOffice, userIds = [] }) {
  const result = { emailed: [], todo_id: null, assigned: [], errors: [] };
  if (!notifyOffice && !userIds.length) return result;

  const { rows: [job] } = await pool.query(
    `SELECT j.id, j.job_number, j.external_ref, c.name AS customer_name
     FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id WHERE j.id = $1`,
    [jobId]
  );
  if (!job) return result;

  // Chosen team members, plus whoever backs the Office mailbox.
  const recipients = new Map();
  if (userIds.length) {
    const { rows } = await pool.query(
      `SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])`, [userIds]
    );
    rows.forEach(u => recipients.set(u.id, u));
  }
  const officeUsers = notifyOffice ? await resolveOfficeUsers() : [];
  officeUsers.forEach(u => recipients.set(u.id, u));

  const { subject, html, text } = noteEmail({
    job, note, authorName: author.name, customerName: job.customer_name,
  });

  // Addresses to write to: each recipient with an email, plus the office
  // mailbox itself — which is worth mailing even when no user account carries
  // that address, since that's where the office actually reads.
  const addresses = new Set(
    [...recipients.values()].map(u => u.email).filter(Boolean).map(e => e.toLowerCase())
  );
  if (notifyOffice) addresses.add(OFFICE_RECORDS_EMAIL.toLowerCase());
  // No point mailing the person who just wrote the note.
  if (author.email) addresses.delete(author.email.toLowerCase());

  for (const to of addresses) {
    try {
      await sendMail({ to, subject, html, text });
      result.emailed.push(to);
    } catch (err) {
      console.error(`[job note] email to ${to} failed:`, err.message);
      result.errors.push(`email to ${to} failed`);
    }
  }

  // The to-do goes to everyone chosen except the author — a task you set
  // yourself by writing a note isn't a handover.
  const assignees = [...recipients.keys()].filter(id => id !== author.id);
  if (!assignees.length) return result;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const label = jobLabel(job);
    const { rows: [todo] } = await client.query(
      `INSERT INTO todos (description, notes, job_id, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [
        `Note on ${label}${job.customer_name ? ` — ${job.customer_name}` : ''}`,
        note.content,
        job.id,
        author.id,
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
    result.assigned = assignees.map(id => recipients.get(id)?.name).filter(Boolean);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[job note] to-do creation failed:', err.message);
    result.errors.push('could not add it to the to-do list');
  } finally {
    client.release();
  }

  return result;
}

module.exports = { notifyJobNote, notifyTargets, resolveOfficeUsers };
