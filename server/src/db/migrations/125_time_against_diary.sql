-- Time logged against a job nobody was booked on.
--
-- The diary says who is on which job and when. The timesheet says where the
-- hours went. Nothing compared the two, so a tech picking the wrong job off
-- the list — the one above the right one, the last job they were on — put
-- hours on it and nobody found out until the job was invoiced and the hours
-- were already on a customer's bill.
--
-- So an entry is checked against the diary as it is saved. It still saves:
-- stopping somebody's day over a booking that was never made is worse than
-- the mistake. What changes is that the person is told at once, the office is
-- emailed, and the reason stays on the entry so it can be found later rather
-- than living only in an email somebody has deleted.
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS schedule_warning TEXT;
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS schedule_warned_at TIMESTAMPTZ;

-- Finding the day's bookings for one person is the whole check, and it runs on
-- every entry saved.
CREATE INDEX IF NOT EXISTS schedules_user_date
  ON schedules (user_id, scheduled_date);

-- The entries still waiting to be looked at, which is what a report of them
-- asks for.
CREATE INDEX IF NOT EXISTS timesheets_schedule_warning
  ON timesheets (schedule_warned_at) WHERE schedule_warning IS NOT NULL;

COMMENT ON COLUMN timesheets.schedule_warning IS
  'Why this entry did not match the diary when it was saved. NULL means it '
  'matched, or predates the check. See migration 125.';
