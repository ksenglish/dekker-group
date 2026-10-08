// Jobs that are In Progress with nothing booked.
//
// A crew finishes for the day, the next visit never gets booked, and the job
// sits on In Progress looking perfectly healthy. Nothing on screen says it is
// stuck — the first anyone hears is usually the customer ringing to ask when we
// are coming back.
//
// So at 7am the office is told: these jobs are open with no appointment today
// or any day after it. Each one wants the same decision — book the next visit,
// or mark it finished.
//
// Once per job, not every morning: the email says it and the to-do keeps saying
// it until someone ticks it off. A job booked again, or moved off In Progress,
// is cleared and will be reported afresh if it stalls a second time.
const pool = require('../db/pool');
const { sendMail } = require('../utils/email');
const { OFFICE_RECORDS_EMAIL } = require('../utils/recordsEmail');
const { resolveOfficeUsers } = require('../utils/jobNoteNotify');
const { getStatusConfig, findStatusByLabel } = require('../utils/jobStatusFlow');

const TZ = 'Pacific/Auckland';
const SEND_HOUR = 7;
const LAST_RUN_KEY = 'stalled_job_sweep_last_run';

const appUrl = () => (process.env.CLIENT_URL || '').replace(/\/$/, '');

const escapeHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function jobLabel(job) {
  if (job?.external_ref) return job.external_ref;
  if (job?.job_number != null) return 'JB' + String(job.job_number).padStart(5, '0');
  return 'Job';
}

// The server runs in UTC and New Zealand is most of a day ahead of it, so every
// "today" and "7am" here is the local one. en-CA gives YYYY-MM-DD.
const nzDate = (at = new Date()) => at.toLocaleDateString('en-CA', { timeZone: TZ });
const nzHour = (at = new Date()) =>
  Number(at.toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }));

// In Progress is matched by label, not by key: the status list is admin-editable
// and the keys have been reused for other things before now.
async function inProgressKey() {
  const config = await getStatusConfig();
  const match = findStatusByLabel(config, l => l === 'in progress' || l === 'inprogress');
  return match?.key || null;
}

// ── Finding them ─────────────────────────────────────────────────────────────

async function findStalledJobs(statusKey) {
  const { rows } = await pool.query(
    `SELECT j.id, j.job_number, j.external_ref, j.type, j.updated_at,
            c.name AS customer_name,
            COALESCE(s.address, j.site_address) AS site_address_full,
            (SELECT MAX(sc.scheduled_date) FROM schedules sc WHERE sc.job_id = j.id) AS last_booked
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN customer_sites s ON s.id = j.site_id
      WHERE j.status = $1
        AND j.stalled_notified_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM schedules sc
           WHERE sc.job_id = j.id
             AND sc.scheduled_date >= $2::date
        )
      ORDER BY j.job_number`,
    [statusKey, nzDate()]
  );
  return rows;
}

// A job that has since been booked, or moved on, stops being reported — so the
// next time it stalls the office hears about it again.
async function clearResolved(statusKey) {
  const { rowCount } = await pool.query(
    `UPDATE jobs j SET stalled_notified_at = NULL
      WHERE j.stalled_notified_at IS NOT NULL
        AND (j.status <> $1
             OR EXISTS (SELECT 1 FROM schedules sc
                         WHERE sc.job_id = j.id AND sc.scheduled_date >= $2::date))`,
    [statusKey, nzDate()]
  );
  return rowCount;
}

// ── Saying so ────────────────────────────────────────────────────────────────

function stalledEmail(jobs) {
  const n = jobs.length;
  const subject = n === 1
    ? `${jobLabel(jobs[0])} is in progress with nothing booked`
    : `${n} jobs are in progress with nothing booked`;

  const row = j => {
    const link = appUrl() ? `${appUrl()}/jobs/${j.id}` : null;
    const label = jobLabel(j);
    const meta = [j.customer_name, j.site_address_full].filter(Boolean).join(' · ');
    const last = j.last_booked
      ? `last booked ${new Date(j.last_booked).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : 'never booked in';
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:15px;font-weight:700;">
            ${link ? `<a href="${escapeHtml(link)}" style="color:#0f172a;text-decoration:none;">${escapeHtml(label)}</a>` : escapeHtml(label)}
          </div>
          ${meta ? `<div style="font-size:13px;color:#475569;">${escapeHtml(meta)}</div>` : ''}
          <div style="font-size:12px;color:#94a3b8;">${escapeHtml(last)}</div>
        </td>
      </tr>`;
  };

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;">
      <p style="margin:0 0 6px;font-size:15px;">
        ${n === 1 ? 'This job is' : `These ${n} jobs are`} <strong>In Progress</strong> with no appointment booked for today or any day after it.
      </p>
      <p style="margin:0 0 16px;color:#475569;font-size:13px;">
        Each one needs either the next visit booked in the diary, or the job marked complete.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        ${jobs.map(row).join('')}
      </table>
    </div>`;

  const text = [
    `${n === 1 ? 'This job is' : `These ${n} jobs are`} In Progress with no appointment booked for today or later.`,
    'Each one needs either the next visit booked in the diary, or the job marked complete.',
    '',
    ...jobs.map(j => [
      jobLabel(j),
      j.customer_name || '',
      j.site_address_full || '',
      appUrl() ? `${appUrl()}/jobs/${j.id}` : '',
    ].filter(Boolean).join(' — ')),
  ].join('\n');

  return { subject, html, text };
}

// One to-do per job rather than one for the batch: each is a separate decision
// about a separate job, and the office ticks them off as they deal with them.
async function raiseTodos(jobs, assignees) {
  if (!assignees.length) return [];
  const made = [];
  for (const j of jobs) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [todo] } = await client.query(
        `INSERT INTO todos (description, notes, job_id, created_by)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [
          `${jobLabel(j)} needs booking or completing${j.customer_name ? ` — ${j.customer_name}` : ''}`,
          [
            'In Progress with no appointment booked for today or later.',
            j.site_address_full ? `Site: ${j.site_address_full}` : '',
            'Book the next visit, or mark the job complete.',
          ].filter(Boolean).join('\n'),
          j.id,
          assignees[0],
        ]
      );
      for (const uid of assignees) {
        await client.query(
          `INSERT INTO todo_assignees (todo_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [todo.id, uid]
        );
      }
      await client.query('COMMIT');
      made.push(todo.id);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[stalled jobs] to-do for ${jobLabel(j)} failed:`, err.message);
    } finally { client.release(); }
  }
  return made;
}

// ── The sweep ────────────────────────────────────────────────────────────────

async function runStalledJobSweep() {
  const result = { jobs: [], emailed: [], todos: [], cleared: 0, skipped: null };

  const statusKey = await inProgressKey();
  // A pipeline with no In Progress stage is a valid setup; there is simply
  // nothing for this to look at.
  if (!statusKey) { result.skipped = 'pipeline has no In Progress status'; return result; }

  result.cleared = await clearResolved(statusKey);

  const jobs = await findStalledJobs(statusKey);
  result.jobs = jobs.map(j => ({ id: j.id, label: jobLabel(j) }));
  if (!jobs.length) return result;

  // Claimed before anything is sent, so a second run cannot send it twice.
  await pool.query(
    'UPDATE jobs SET stalled_notified_at = NOW() WHERE id = ANY($1::uuid[])',
    [jobs.map(j => j.id)]
  );

  const { subject, html, text } = stalledEmail(jobs);

  let officeUsers = [];
  try {
    officeUsers = await resolveOfficeUsers();
  } catch (err) {
    console.error('[stalled jobs] could not resolve the office:', err.message);
  }

  const addresses = new Set([OFFICE_RECORDS_EMAIL.toLowerCase()]);
  officeUsers.forEach(u => { if (u.email) addresses.add(u.email.toLowerCase()); });
  for (const to of addresses) {
    try {
      await sendMail({ to, subject, html, text });
      result.emailed.push(to);
    } catch (err) {
      console.error(`[stalled jobs] email to ${to} failed:`, err.message);
    }
  }

  result.todos = await raiseTodos(jobs, officeUsers.map(u => u.id).filter(Boolean));

  console.log(`Stalled-job sweep: ${jobs.length} job${jobs.length === 1 ? '' : 's'} in progress with nothing booked — ${jobs.map(jobLabel).join(', ')}`);
  return result;
}

// ── When it runs ─────────────────────────────────────────────────────────────
//
// Checked hourly and fired on the first check at or after 7am local time, with
// the date it last ran kept in settings. That survives a restart — a deploy at
// 7:05 cannot send the same list twice — and a missed hour still goes out at
// 8am rather than being skipped for the day.

async function lastRunDate() {
  try {
    const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [LAST_RUN_KEY]);
    return rows[0]?.value?.date || null;
  } catch { return null; }
}

async function markRun(date) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [LAST_RUN_KEY, JSON.stringify({ date })]
  );
}

async function tick(now = new Date()) {
  const today = nzDate(now);
  if (nzHour(now) < SEND_HOUR) return { ran: false, reason: 'before 7am' };
  if (await lastRunDate() === today) return { ran: false, reason: 'already run today' };
  // Marked before the work, not after: a failure part way through must not
  // leave it retrying the whole list every hour for the rest of the day.
  await markRun(today);
  return { ran: true, result: await runStalledJobSweep() };
}

const HOUR = 60 * 60 * 1000;

function startStalledJobSweep() {
  const run = () => tick().catch(err =>
    console.error('Stalled-job sweep failed:', err.message));
  // Offset from the site-visit sweep so the two are not competing at startup.
  setTimeout(run, 90 * 1000).unref();
  setInterval(run, HOUR).unref();
}

module.exports = { runStalledJobSweep, startStalledJobSweep, tick, findStalledJobs, inProgressKey };
