-- A timer that is running right now.
--
-- The timer lived entirely in the browser's own storage: start it on a job
-- and nothing anywhere else knew. So the office could not see who was on the
-- clock, a tech who closed the tab on one phone could not pick it up on
-- another, and a timer left running over a weekend was invisible until it
-- produced sixty hours on a Monday.
--
-- One row per person, because a person is in one place at a time. Starting a
-- timer on another job replaces the row rather than adding one, which is the
-- honest reading of what somebody has just done.
CREATE TABLE IF NOT EXISTS active_timers (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  billing_rate_id VARCHAR(50),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Everyone on a given job, which is what the job's own Time tab asks for.
CREATE INDEX IF NOT EXISTS active_timers_job ON active_timers (job_id);

COMMENT ON TABLE active_timers IS
  'Timers running right now, one per person. Deleted when the time is saved '
  'or the timer discarded — this is not a history. See migration 126.';
