-- Migration 101: the live job service report
--
-- A charge-up job accrues labour and materials for weeks before it is invoiced,
-- and the customer has no way to watch it happen. The report is that view: the
-- scope of works, every hour clocked, every supplier line, and what it comes to
-- — the same page the office sees, on a link the customer can open.
--
-- The link is a token rather than the job id, so it can be handed out without
-- exposing anything else and revoked without touching the job. Null until
-- someone chooses to share, the same way a quote's public token works.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_report_token UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_service_report_token
  ON jobs (service_report_token) WHERE service_report_token IS NOT NULL;

-- What the customer pays for materials, over what the supplier charged. Jobs
-- are won on different terms, so the house default is only a starting point —
-- null means "use the default", and a number here overrides it for this job.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_report_markup_pct NUMERIC(6,2);

COMMENT ON COLUMN jobs.service_report_token IS
  'Share link for the live service report. Null = not shared. See migration 101.';
