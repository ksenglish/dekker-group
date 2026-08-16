-- Migration 080: bring Tradify labour hours into timesheets
--
-- The Tradify import captured the export's "Time" column as raw text on
-- jobs.time_log but never turned it into timesheet entries, so imported jobs
-- showed no labour on the Time tab. Entries created from that text are tagged
-- source='tradify' so they can be told apart from a timer or a manual entry.

ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS timesheets_source_check;
ALTER TABLE timesheets ADD CONSTRAINT timesheets_source_check
  CHECK (source IN ('timer', 'manual', 'tradify'));

-- Makes the backfill safe to run repeatedly: the same person, job, day and
-- start time can only land once. Partial, so it constrains nothing about the
-- entries staff record themselves.
CREATE UNIQUE INDEX IF NOT EXISTS timesheets_tradify_unique_idx
  ON timesheets (job_id, user_id, date, start_time)
  WHERE source = 'tradify';

-- Records when a job's time_log was last converted, so the backfill can report
-- what it has already done rather than guessing.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_log_imported_at TIMESTAMPTZ;
