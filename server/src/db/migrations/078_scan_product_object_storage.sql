-- The rest of the files move out of the database, following job_attachments:
-- scanned supplier invoices and receipts, and product images and brochures.
--
-- As before, NULL means the row predates the change and its bytes are still in
-- the base64 column, so both are readable side by side and nothing has to be
-- migrated up front.

-- Supplier invoice and receipt scans (PDF Check, job costs, Operating Costs).
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
CREATE INDEX IF NOT EXISTS idx_job_cost_scans_storage_key
  ON job_cost_scans(storage_key) WHERE storage_key IS NOT NULL;

-- Price list product photo and brochure.
ALTER TABLE products ADD COLUMN IF NOT EXISTS media_key TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS brochure_key TEXT;
