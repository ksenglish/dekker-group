-- Migration 103: labour and travel rates per person on the service report
--
-- A job rate covers the common case, but not the one that keeps coming up: an
-- electrician and an HVAC installer drive to site in the same van, so the trip
-- is charged once rather than twice, and the installer's hours go out at a
-- lower rate than the sparky's.
--
-- So a rate can now be set against a person on a job. Nothing here is required:
-- a row with nulls in it changes nothing, and a person with no row at all is
-- charged the way they were before — the job's rate, or failing that the house
-- billing rate the hour was logged against.
CREATE TABLE IF NOT EXISTS job_service_report_rates (
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Dollars per hour excl. GST for this person's non-travel hours on this job.
  labour_rate NUMERIC(10,2),

  -- How this person's travel is charged on this job:
  --   hourly — their travel hours at travel_rate
  --   fixed  — travel_rate for each trip they recorded
  --   none   — not charged at all, which is the passenger in the van
  -- Null means the job's own travel setting applies, as before.
  travel_mode TEXT CHECK (travel_mode IN ('hourly', 'fixed', 'none')),
  travel_rate NUMERIC(10,2),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, user_id)
);

COMMENT ON TABLE job_service_report_rates IS
  'Per-person labour and travel rates for one job''s service report. Falls back '
  'to the job''s own rates, then the house billing rates. See migration 103.';
