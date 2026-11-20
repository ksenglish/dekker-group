-- Why the hours were outside the booking, and who said they were fine.
--
-- Migration 125 made an entry that does not match the diary save anyway, warn
-- the person and email the office. What it could not do was answer the only
-- question the office actually has when that email arrives: why. So they rang
-- the tech, who by then was on another roof, and the email sat in the inbox.
--
-- Two things fix that. The person recording the hours has to say why before
-- they can record them, so the answer arrives with the question. And somebody
-- in the office marks it approved once they are happy, so an entry that has
-- been looked at stops looking the same as one that has not — until then it is
-- red on the timesheet, the way overlapping hours are.
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS schedule_reason TEXT;
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS schedule_approved_at TIMESTAMPTZ;
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS schedule_approved_by UUID REFERENCES users(id);

-- What a week of these looks like, and what the office is being asked to
-- clear: flagged, not yet approved.
CREATE INDEX IF NOT EXISTS timesheets_schedule_unapproved
  ON timesheets (date)
  WHERE schedule_warning IS NOT NULL AND schedule_approved_at IS NULL;

COMMENT ON COLUMN timesheets.schedule_reason IS
  'What the person said when they recorded hours outside their booking. '
  'Required from them at the time. See migration 135.';
COMMENT ON COLUMN timesheets.schedule_approved_at IS
  'When the office accepted these hours despite the diary. NULL while it is '
  'still outstanding, which is what turns the entry red. See migration 135.';
