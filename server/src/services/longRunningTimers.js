// The timer somebody forgot to stop.
//
// A timer belongs to one person and is stopped on their phone, so when it does
// not get stopped there is nobody to notice. It shows up the next morning on
// the office dashboard as twenty-six hours on the clock, and the office spends
// the morning working out what the person actually did and rewriting their
// timesheet for them.
//
// So at 7pm, whoever still has one running is told. They can stop it and
// correct the entry themselves while they still remember the day, which is the
// whole point — the office correcting somebody else's hours a day later is a
// guess with an audit trail.
//
// Once per person per evening. A timer left running over a long weekend is
// asked about each night rather than once and then forgotten.
const pool = require('../db/pool');
const { sendMail } = require('../utils/email');

const TZ = process.env.BUSINESS_TIMEZONE || 'Pacific/Auckland';
const SEND_HOUR = Number(process.env.TIMER_NUDGE_HOUR || 19);

// The server runs in UTC and New Zealand is most of a day ahead of it, so every
// "today" and "7pm" here is the local one. en-CA gives YYYY-MM-DD.
const localDate = (at = new Date()) => at.toLocaleDateString('en-CA', { timeZone: TZ });
const localHour = (at = new Date()) =>
  Number(at.toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }));
const localTime = at => new Date(at).toLocaleTimeString('en-NZ',
  { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const appUrl = () => (process.env.CLIENT_URL || '').trim().replace(/\/+$/, '');
const linkTo = path => {
  const base = appUrl();
  if (!base) return null;
  return /^https?:\/\//i.test(base) ? `${base}${path}` : `https://${base}${path}`;
};

const escapeHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function jobLabel(row) {
  if (row?.external_ref) return row.external_ref;
  if (row?.job_number != null) return 'JB' + String(row.job_number).padStart(5, '0');
  return 'the job';
}

function runningFor(startedAt, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Everyone with a timer still going who has not been asked about it today.
async function findRunning(today = localDate()) {
  const { rows } = await pool.query(
    `SELECT t.user_id, t.job_id, t.started_at, t.billing_rate_id,
            u.name AS user_name, u.email AS user_email,
            j.job_number, j.external_ref,
            c.name AS customer_name
       FROM active_timers t
       JOIN users u ON u.id = t.user_id
       JOIN jobs j ON j.id = t.job_id
       LEFT JOIN customers c ON c.id = j.customer_id
      WHERE u.is_active
        AND u.email IS NOT NULL AND u.email <> ''
        AND (t.last_warned_on IS NULL OR t.last_warned_on <> $1::date)
      ORDER BY t.started_at`,
    [today]
  );
  return rows;
}

// Marked whether or not the email got out.
//
// The alternative is a mail server having a bad evening and the same person
// being told six times before midnight. Once a night is the promise; a missed
// night is better than a mailbox full of the same sentence.
async function markWarned(userId, today) {
  await pool.query(
    'UPDATE active_timers SET last_warned_on = $2::date WHERE user_id = $1',
    [userId, today]
  );
}

function nudgeEmail(row, now = Date.now()) {
  const label = jobLabel(row);
  const where = [label, row.customer_name].filter(Boolean).join(' · ');
  const link = linkTo(`/jobs/${row.job_id}?tab=time`);
  const elapsed = runningFor(row.started_at, now);
  const started = localTime(row.started_at);

  const subject = `Your timer is still running — ${elapsed} on ${label}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;color:#0f172a;">
      <p style="margin:0 0 12px;">Hi ${escapeHtml(row.user_name?.split(' ')[0] || 'there')},</p>
      <p style="margin:0 0 12px;">Your timer on <strong>${escapeHtml(where)}</strong> is still
        going. It started at <strong>${escapeHtml(started)}</strong> and has been running for
        <strong>${escapeHtml(elapsed)}</strong>.</p>
      <p style="margin:0 0 12px;">If you have finished for the day, stop it and check the hours
        before you knock off — it is quicker to fix tonight, while you remember the day, than
        for the office to work it out tomorrow.</p>
      ${link ? `<p style="margin:0 0 18px;">
        <a href="${link}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:7px;font-weight:600;">Open the job and stop the timer</a>
      </p>` : ''}
      <p style="margin:0;color:#64748b;font-size:13px;">Still on site? Ignore this — it is just a
        check at 7pm each evening.</p>
    </div>`;
  const text = [
    `Your timer on ${where} is still running.`,
    `Started ${started}, going for ${elapsed}.`,
    'If you have finished for the day, stop it and check the hours before you knock off.',
    link || '',
    'Still on site? Ignore this.',
  ].filter(Boolean).join('\n\n');
  return { subject, html, text };
}

async function runTimerNudge(now = new Date()) {
  const today = localDate(now);
  const running = await findRunning(today);
  const sent = [];
  const failed = [];
  for (const row of running) {
    await markWarned(row.user_id, today);
    try {
      const { subject, html, text } = nudgeEmail(row, now.getTime());
      await sendMail({ to: row.user_email, subject, html, text });
      sent.push(row.user_name);
    } catch (err) {
      // One address that bounces must not stop the rest of the crew being told.
      console.error(`[timer nudge] could not email ${row.user_name}:`, err.message);
      failed.push(row.user_name);
    }
  }
  return { running: running.length, sent, failed };
}

// ── When it runs ─────────────────────────────────────────────────────────────
//
// Checked hourly and fired on the first check at or after 7pm local time. The
// "asked about it today" flag lives on the timer row rather than in a settings
// key, because this is per person: somebody who starts a timer at 8pm, after
// the sweep has run, should still be asked tomorrow evening.

async function tick(now = new Date()) {
  if (localHour(now) < SEND_HOUR) return { ran: false, reason: `before ${SEND_HOUR}:00` };
  return { ran: true, result: await runTimerNudge(now) };
}

const HOUR = 60 * 60 * 1000;

function startTimerNudge() {
  const run = () => tick().catch(err =>
    console.error('Timer nudge failed:', err.message));
  // Offset from the other two sweeps so nothing is competing at startup.
  setTimeout(run, 150 * 1000).unref();
  setInterval(run, HOUR).unref();
}

module.exports = {
  runTimerNudge, startTimerNudge, tick, findRunning, nudgeEmail, runningFor,
};
