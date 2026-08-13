// Moving a job off "Scheduled - Site Visit" once the visit day has passed.
//
// Booking a sales appointment puts a job on Site Visit. The only thing that
// moved it on again was the rep stopping the timer, which prompts them about
// the quote — so a rep who never started a timer left the job sitting on Site
// Visit indefinitely, long after the visit happened.
//
// This sweeps up the ones the timer never covered: the visit day has been and
// gone and nothing has been sent to the customer, so the job is waiting on a
// quote. A draft sitting on the job does not count, matching what the rep is
// told when they stop a timer without having sent one.

const pool = require('../db/pool');
const { getStatusConfig, findStatusByLabel } = require('../utils/jobStatusFlow');
const { quoteDeliveredSql } = require('../utils/quoteDelivery');

const isSiteVisit     = l => l.includes('site visit');
const isAwaitingQuote = l => l.includes('awaiting') && l.includes('quote');

// Both statuses are matched by label rather than key, since these are
// configurable per install and the keys are not what anyone renames.
async function runSiteVisitSweep() {
  const config = await getStatusConfig();
  const from = findStatusByLabel(config, isSiteVisit);
  const to = findStatusByLabel(config, isAwaitingQuote);
  // Nothing to do on a pipeline without both stages, which is a valid setup.
  if (!from || !to) return { moved: [], skipped: 'pipeline has no site-visit or awaiting-quote status' };

  // "By the next day" is measured against the local date, not UTC — the server
  // runs in UTC and is ~12 hours behind, so a plain CURRENT_DATE would leave
  // jobs sitting for an extra day over most of the working evening.
  const { rows } = await pool.query(
    `UPDATE jobs j
        SET status = $1, updated_at = NOW()
      WHERE j.status = $2
        AND EXISTS (
          SELECT 1 FROM schedules s
           WHERE s.job_id = j.id
             AND s.appointment_type = 'sales'
             AND s.scheduled_date < (NOW() AT TIME ZONE 'Pacific/Auckland')::date
        )
        AND NOT EXISTS (
          SELECT 1 FROM quotes q
           WHERE q.job_id = j.id AND ${quoteDeliveredSql('q')}
        )
      RETURNING j.id, j.job_number`,
    [to.key, from.key]
  );

  if (rows.length) {
    console.log(
      `Site-visit sweep: moved ${rows.length} job${rows.length === 1 ? '' : 's'} ` +
      `from "${from.label}" to "${to.label}" — ${rows.map(r => r.job_number).join(', ')}`
    );
  }
  return { moved: rows };
}

// Hourly rather than once at midnight: a missed run then costs an hour instead
// of a day, and the sweep is idempotent so running it often is harmless. The
// first run is delayed a little so it isn't competing with startup.
const HOUR = 60 * 60 * 1000;

function startSiteVisitSweep() {
  const run = () => runSiteVisitSweep().catch(err =>
    console.error('Site-visit sweep failed:', err.message));

  setTimeout(run, 60 * 1000).unref();
  // unref so the interval never holds the process open during a shutdown.
  setInterval(run, HOUR).unref();
}

module.exports = { runSiteVisitSweep, startSiteVisitSweep };
