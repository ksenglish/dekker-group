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

// Job descriptions and diary notes are rich text, and they arrive here as
// stored: markup and all. Escaped straight into the email they printed as
// their own source —
//
//   Builders Crack.<div>Wants the job done before Xmas if possible.&nbsp;</div>
//
// — which is the whole note still in there, just unreadable. Tags out,
// entities back to characters, one line of plain words, cut short because the
// office is scanning this on a phone and the first sentence is the one that
// says which job it is.
const plain = (value, max = 150) => {
  const text = String(value ?? '')
    // Both ends of a block tag become a space. Only closing them left
    // "Builders Crack.<div>Wants the job done" as "Crack.Wants the job done",
    // which is two sentences run together rather than one read.
    .replace(/<\/?(br|p|div|li|tr|ul|ol|h[1-6]|blockquote)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};
// Plain first, then escaped for the email — every use below is esc(plain(x)).
// The other way round escapes the markup into visible text and leaves it
// there, which is the bug above.

const jobRef = e => e.external_ref
  || (e.job_number != null ? `JB${String(e.job_number).padStart(5, '0')}` : 'a job');

// In the time the work happened, not the server's. Render runs in UTC, and a
// 21:55 start printed as 08:55 in the office's email is worse than useless —
// it reads as a different day's work.
const ZONE = process.env.BUSINESS_TIMEZONE || 'Pacific/Auckland';

const when = t => (t
  ? new Date(t).toLocaleTimeString('en-NZ',
    { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  : null);

// Never throws, and never holds the save up. A time entry that is recorded and
// unreported beats one that was refused because a mail server was slow.
async function notify({ entry, warning, reason, bookings = [], appUrl }) {
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
      const title = plain(b.job_title, 70);
      return `<li>${esc(jobRef(b))} — ${esc(times)}${title ? ` — ${esc(title)}` : ''}</li>`;
    }).join('')
    : '<li>Nothing booked for them that day.</li>';

  // Into the job's Time tab, where the entry is sitting in red with an
  // Approve button on it. The link does not approve anything by itself: an
  // emailed link that writes an approval approves for whoever the email gets
  // forwarded to, and these hours end up on a customer's invoice.
  const link = appUrl && entry.job_id
    ? `${appUrl.replace(/\/$/, '')}/jobs/${entry.job_id}?tab=timesheets`
    : null;

  // What the office is actually reading: the job in words, what the person
  // typed on the entry, and — the point of the whole email — what they said
  // about being outside the booking.
  const jobTitle = plain(entry.job_title, 90);
  const note = plain(entry.description, 150);
  const said = plain(reason ?? entry.schedule_reason, 400);

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">
      <p style="margin:0 0 12px"><strong>${esc(who)}</strong> logged time on <strong>${esc(ref)}</strong>
         that does not match the diary.</p>
      <p style="margin:0 0 4px"><strong>What was logged</strong></p>
      <ul style="margin:0 0 14px;padding-left:20px">
        <li>${esc(day)}${span ? ` — ${esc(span)}` : ''}</li>
        <li>${esc(entry.hours)} hour${Number(entry.hours) === 1 ? '' : 's'} on ${esc(ref)}${jobTitle ? ` — ${esc(jobTitle)}` : ''}</li>
        ${note ? `<li>${esc(note)}</li>` : ''}
        <li>Entered ${entry.source === 'timer' ? 'with the timer' : 'by hand'}</li>
      </ul>
      <p style="margin:0 0 4px"><strong>What the diary says</strong></p>
      <ul style="margin:0 0 14px;padding-left:20px">${diary}</ul>
      <p style="margin:0 0 14px;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px">
        ${esc(warning)}
      </p>
      ${said ? `
      <p style="margin:0 0 4px"><strong>${esc(who)} says</strong></p>
      <p style="margin:0 0 14px;padding:10px 12px;background:#f8fafc;border-left:3px solid #94a3b8;border-radius:4px">
        ${esc(said)}
      </p>` : ''}
      <p style="margin:0 0 16px;color:#475569">
        The entry was saved — stopping someone's day over a booking that was never
        made would be worse than the mistake. It stays flagged in red on their
        timesheet until somebody in the office approves it, so it cannot go onto
        an invoice unnoticed.
      </p>
      ${link ? `
      <p style="margin:0 0 10px">
        <a href="${esc(link)}" style="display:inline-block;padding:11px 18px;background:#1d4ed8;color:#ffffff;
           font-weight:600;font-size:14px;text-decoration:none;border-radius:8px">
          Open ${esc(ref)} and approve these hours
        </a>
      </p>
      <p style="margin:0;font-size:12px;color:#64748b">
        Opens the job's Time tab. If the hours belong somewhere else, change the
        job on the entry instead and the flag clears itself.
      </p>` : ''}
    </div>`;

  try {
    await sendMail({
      to: OFFICE_RECORDS_EMAIL,
      subject: `Time logged outside the diary — ${who}, ${ref}`,
      html,
      text: [
        `${who} logged ${entry.hours} hours on ${ref} on ${day}.`,
        warning,
        said ? `${who} says: ${said}` : null,
        link ? `Approve them on the job: ${link}` : null,
      ].filter(Boolean).join('\n\n'),
    });
    return true;
  } catch (err) {
    console.error('[timesheets] could not tell the office:', err.message);
    return false;
  }
}

module.exports = { notify };
