-- Migration 035: Tradify job import support
-- Adds fields to hold imported job data and allows an 'undefined' placeholder role.

-- Extra columns on jobs to capture everything coming across from Tradify
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_ref         VARCHAR(50);   -- e.g. JB00885
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_status      VARCHAR(100);  -- original Tradify status text
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS place_id             TEXT;          -- Google Place Id
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_contact          VARCHAR(255);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_contact_phone    VARCHAR(50);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_contact_mobile   VARCHAR(50);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS materials            TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_log             TEXT;          -- raw Tradify "Time" entries
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source               VARCHAR(30);   -- 'tradify' for imported jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS entered_by           VARCHAR(255);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS entered_on           TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS imported_at          TIMESTAMPTZ;

-- One row per Tradify job number; lets us re-run the import safely without duplicating
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_external_ref
  ON jobs(external_ref) WHERE external_ref IS NOT NULL;

-- Allow placeholder accounts for team members we don't have full details for yet
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'office', 'field_tech', 'sales', 'operations', 'subcontractor', 'undefined'));
