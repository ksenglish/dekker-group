-- Timers left running, and the nudge that asks about them.
--
-- A timer is stopped on the phone and the request saying so never reaches the
-- server — no signal on site, or iOS freezing the page the moment it is
-- backgrounded. The office finds out the next morning, when somebody is still
-- showing as on the clock after twenty-six hours.
--
-- The client now keeps saying "stopped" until it is heard. This is the
-- backstop for the phone that never comes back: at 7pm whoever still has a
-- timer going gets an email, so they can stop and correct it themselves rather
-- than the office unpicking a timesheet in the morning.

-- The last local day this timer was asked about. Null means never.
--
-- A day rather than a timestamp, and compared against the business's day
-- rather than the server's: a timer left running over a long weekend should be
-- asked about each evening, not once and then forgotten.
ALTER TABLE active_timers ADD COLUMN IF NOT EXISTS last_warned_on DATE;

-- Who stopped it, when it is not the person it belongs to.
--
-- An admin can now stop somebody else's timer and record the hours for them.
-- That is a correction made on another person's behalf, and the record of who
-- made it outlives the timer row itself only if it is written down — so the
-- timesheet entry carries it, not this table.
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS corrected_by UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN timesheets.corrected_by IS
  'Set when somebody other than the owner recorded these hours — an admin stopping a timer that was left running.';
