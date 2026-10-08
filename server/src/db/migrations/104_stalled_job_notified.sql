-- Migration 104: telling the office about a job in progress with nothing booked
--
-- A job goes to In Progress, the crew finishes for the day, and the next visit
-- never gets booked. Nothing is wrong on screen — the job looks live — so it
-- sits there until somebody happens to notice, which is usually the customer
-- ringing to ask when we are coming back.
--
-- The morning sweep that catches those needs somewhere to record that it has
-- said so, or it would say so again every morning until the job moved. Cleared
-- the moment the job is booked again or leaves In Progress, so a job that
-- stalls a second time is reported a second time.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stalled_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN jobs.stalled_notified_at IS
  'When the office was last told this job is in progress with nothing booked. '
  'Null = not currently reported. See migration 104.';
