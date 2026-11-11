// Does this time entry match what the diary says?
//
// The diary says who is on which job and when. The timesheet says where the
// hours went. Nothing compared the two, so a tech picking the wrong job off
// the list — the one above the right one, or the last job they were on — put
// hours on it and nobody found out until the job was invoiced and the hours
// were already on a customer's bill.
//
// The check never refuses an entry. Somebody standing on a roof at 4pm with a
// job that was never booked needs their time recorded, not an argument; and a
// booking that was never made is the office's mistake as often as theirs. So
// it saves, says so plainly, and tells the office the same minute.
const pool = require('../db/pool');

// How far outside the booked hours is still the same day's work. Fifteen
// minutes covers arriving early, finishing late, and the rounding the timer
// does to the nearest quarter hour, without letting a whole wrong afternoon
// through.
// How far outside the booked hours is still the same day's work.
//
// Forty-five minutes: a tech who stays to finish a run, or starts before
// the booking because they were passing, is not an incident and the office
// does not want an email about it. Set in Settings → Billing Rates, because
// the right number is a thing a business learns rather than something that
// should need a deploy.
const DEFAULT_GRACE_MINUTES = Number(process.env.TIMESHEET_GRACE_MINUTES || 45);

async function graceMinutes(client = pool) {
  try {
    const { rows } = await client.query(
      `SELECT value FROM settings WHERE key = 'timesheet_grace_minutes'`);
    const set = Number(rows[0]?.value);
    return Number.isFinite(set) && set >= 0 ? set : DEFAULT_GRACE_MINUTES;
  } catch { return DEFAULT_GRACE_MINUTES; }
}


// The zone the business works in, which is the one the diary's TIMEs were
// typed in and the one a tech reads off their phone. Not the server's: that
// runs in UTC, and reading an instant with getHours() there turned a timer
// stopped at 21:55 into "08:55" in the warning — thirteen hours out, and
// thirteen hours is the difference between a late finish and a nonsense.
const ZONE = process.env.BUSINESS_TIMEZONE || 'Pacific/Auckland';

// Intl does the daylight-saving arithmetic, which is the whole reason not to
// do this with a fixed offset: Auckland is +12 for half the year and +13 for
// the other half, and the changeover lands mid-timesheet-week.
const inZone = new Intl.DateTimeFormat('en-NZ', {
  timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Minutes from midnight, for whichever of the two shapes a time arrives in:
// a TIME column out of the diary ("07:30:00"), or a full timestamp off an
// entry. Both end up as the time somebody standing in Tauranga would read.
function minutesOf(value) {
  if (!value) return null;
  const s = String(value);
  // A TIME has no zone and never did: it was typed as wall-clock time.
  if (/^\d{2}:\d{2}/.test(s)) {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const parts = inZone.formatToParts(d);
  const h = Number(parts.find(p => p.type === 'hour')?.value);
  const m = Number(parts.find(p => p.type === 'minute')?.value);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

// A date as the diary stores it. The column comes back from the driver as a
// Date, and String()ing one of those gives "Tue Nov 10 2026 …" — which the
// next query refuses, quietly, as a failed check rather than a warning.
function dayOf(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
      + `-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}

const clock = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const hoursWord = h => `${Number(h) % 1 === 0 ? Number(h) : Number(h).toFixed(2)} hour${Number(h) === 1 ? '' : 's'}`;

// What the diary has for this person on this day.
async function bookingsFor({ userId, date }, client = pool) {
  const { rows } = await client.query(
    `SELECT s.job_id, s.start_time, s.end_time,
            j.job_number, j.external_ref, j.description AS job_title
       FROM schedules s
       LEFT JOIN jobs j ON j.id = s.job_id
      WHERE s.user_id = $1 AND s.scheduled_date = $2
      ORDER BY s.start_time NULLS FIRST`,
    [userId, dayOf(date)]
  );
  return rows;
}

const jobRef = b => b.external_ref || (b.job_number != null ? `JB${String(b.job_number).padStart(5, '0')}` : 'a job');

// The check itself. Returns null when the entry matches the diary, or a
// sentence saying what does not — written to be read by the person who typed
// it, not by whoever wrote this.
async function check({ jobId, userId, date, startTime, endTime, hours }, client = pool) {
  if (!jobId) return null;
  const GRACE_MINUTES = await graceMinutes(client);
  const day = await bookingsFor({ userId, date }, client);
  const mine = day.filter(b => b.job_id === jobId);

  // Nothing booked on this job for this person today. The common case, and the
  // one the whole thing exists for.
  if (!mine.length) {
    const elsewhere = day.filter(b => b.job_id);
    if (!elsewhere.length) {
      return 'There is nothing in the diary for you on this day, so this job has not been checked against it.';
    }
    const names = [...new Set(elsewhere.map(jobRef))];
    return `The diary has you on ${names.join(' and ')} this day, not on this job.`
      + ' If the work really was on this job, the office needs to know so the diary matches.';
  }

  // Booked, but with no times against it — a whole day on site. Nothing to
  // compare the clock to, so the day itself is the answer.
  const timed = mine.filter(b => b.start_time && b.end_time);
  if (!timed.length) return null;

  const from = Math.min(...timed.map(b => minutesOf(b.start_time)));
  const to = Math.max(...timed.map(b => minutesOf(b.end_time)));
  const booked = `${clock(from)}–${clock(to)}`;

  const started = minutesOf(startTime);
  const finished = minutesOf(endTime);

  if (started != null && finished != null) {
    const early = started < from - GRACE_MINUTES;
    const late = finished > to + GRACE_MINUTES;
    if (early && late) {
      return `You are booked on this job ${booked}, and this runs ${clock(started)}–${clock(finished)}.`;
    }
    if (early) {
      return `You are booked on this job from ${clock(from)}, and this starts at ${clock(started)}.`;
    }
    if (late) {
      return `You are booked on this job until ${clock(to)}, and this runs to ${clock(finished)}.`;
    }
    return null;
  }

  // Hours with no clock on them. All that can be said is whether there are
  // more of them than the day was booked for.
  const bookedHours = (to - from) / 60;
  const logged = Number(hours) || 0;
  if (logged > bookedHours + GRACE_MINUTES / 60) {
    return `You are booked on this job for ${hoursWord(bookedHours)} (${booked}),`
      + ` and this logs ${hoursWord(logged)}.`;
  }
  return null;
}

module.exports = { check, bookingsFor, graceMinutes, DEFAULT_GRACE_MINUTES };
