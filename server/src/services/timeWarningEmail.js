// Telling the office that time went somewhere the diary did not expect.
//
// The point of the email is that somebody who is not on the roof sees it the
// same day. Catching it a week later is still better than catching it after
// the invoice has gone, but only just — by then the tech has forgotten which
// job they were really on, and the correction becomes a guess.
const { sendMail } = require('../utils/email');
const { OFFICE_RECORDS_EMAIL } = require('../utils/recordsEmail');

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const jobRef = e => e.external_ref
  || (e.job_number != null ? `JB${String(e.job_number).padStart(5, '0')}` : 'a job');

const when = t => (t
  ? new Date(t).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })
  : null);

// Never throws, and never holds the save up. A time entry that is recorded and
// unreported beats one that was refused because a mail server was slow.
async function notify({ entry, warning, bookings = [], appUrl }) {
  const who = entry.user_name || 'Somebody';
  const ref = jobRef(entry);
  const day = new Date(entry.date).toLocaleDateString('en-NZ',
    { weekday: 'long', day: 'numeric', month: 'long' });
  const span = when(entry.start_time) && when(entry.end_time)
    ? `${when(entry.start_time)}–${when(entry.end_time)}`
    : null;

  const diary = bookings.length
    ? bookings.map(b => {
      const times = b.start_time && b.end_time
        ? `${String(b.start_time).slice(0, 5)}–${String(b.end_time).slice(0, 5)}`
        : 'no times set';
      return `<li>${esc(jobRef(b))} — ${esc(times)}${b.job_title ? ` — ${esc(b.job_title)}` : ''}</li>`;
    }).join('')
    : '<li>Nothing booked for them that day.</li>';

  const link = appUrl && entry.job_id ? `${appUrl.replace(/\/$/, '')}/jobs/${entry.job_id}` : null;

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">
      <p style="margin:0 0 12px"><strong>${esc(who)}</strong> logged time on <strong>${esc(ref)}</strong>
         that does not match the diary.</p>
      <p style="margin:0 0 4px"><strong>What was logged</strong></p>
      <ul style="margin:0 0 14px;padding-left:20px">
        <li>${esc(day)}${span ? ` — ${esc(span)}` : ''}</li>
        <li>${esc(entry.hours)} hour${Number(entry.hours) === 1 ? '' : 's'} on ${esc(ref)}${entry.job_title ? ` — ${esc(entry.job_title)}` : ''}</li>
        ${entry.description ? `<li>${esc(entry.description)}</li>` : ''}
        <li>Entered ${entry.source === 'timer' ? 'with the timer' : 'by hand'}</li>
      </ul>
      <p style="margin:0 0 4px"><strong>What the diary says</strong></p>
      <ul style="margin:0 0 14px;padding-left:20px">${diary}</ul>
      <p style="margin:0 0 14px;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px">
        ${esc(warning)}
      </p>
      <p style="margin:0 0 14px;color:#475569">
        The entry was saved — stopping someone's day over a booking that was never
        made would be worse than the mistake. It needs checking before the job is
        invoiced: either the hours belong on another job, or the diary is missing
        the booking.
      </p>
      ${link ? `<p style="margin:0"><a href="${esc(link)}">Open ${esc(ref)}</a></p>` : ''}
    </div>`;

  try {
    await sendMail({
      to: OFFICE_RECORDS_EMAIL,
      subject: `Time logged outside the diary — ${who}, ${ref}`,
      html,
      text: `${who} logged ${entry.hours} hours on ${ref} on ${day}. ${warning}`,
    });
    return true;
  } catch (err) {
    console.error('[timesheets] could not tell the office:', err.message);
    return false;
  }
}

module.exports = { notify };
