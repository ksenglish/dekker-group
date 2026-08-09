-- Filing for supplier PDFs that aren't attached to a job.
--
-- Costs split two ways. Direct costs are already modelled: a scan with a job_id
-- is a cost of doing that job, and needs no filing. Operating costs are
-- everything else — power, phones, subscriptions — which belong to the business
-- rather than to any job, and are filed by supplier instead.

CREATE TABLE IF NOT EXISTS cost_folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(150) NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_folders_name ON cost_folders(LOWER(name));

-- A scan filed into a folder. Null for everything else: job-linked scans are
-- filed by their job, and anything still awaiting a decision sits in PDF Check.
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES cost_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_cost_scans_folder ON job_cost_scans(folder_id);

-- status already carries 'matched' and 'unmatched' and has no CHECK constraint,
-- so 'filed' needs no schema change — recorded here so the values are findable.
