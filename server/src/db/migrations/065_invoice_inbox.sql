-- Allow job_cost_scans to exist without a matched job (invoice inbox)
ALTER TABLE job_cost_scans ALTER COLUMN job_id DROP NOT NULL;

-- Inbox tracking columns
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'matched';
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS supplier TEXT;
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS detected_job_number TEXT;
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS parsed_items JSONB;

-- Existing rows (all have a job_id) are already matched
UPDATE job_cost_scans SET status = 'matched' WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_cost_scans_status ON job_cost_scans(status);
