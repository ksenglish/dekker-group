-- Migration 099: what a scanned supplier document is, and when it was dated
--
-- The Costs tab lists every cost on a job as one flat list, with no way to tell
-- which supplier invoice each line came off. Grouping them needs the document's
-- own date (not when it happened to be uploaded) and whether it is an invoice
-- or a credit note — the latter so a credit reads as a credit on screen rather
-- than as a row of minus signs someone has to notice.
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS invoice_date DATE;
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS document_type VARCHAR(20) NOT NULL DEFAULT 'invoice';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_cost_scans_document_type_check'
  ) THEN
    ALTER TABLE job_cost_scans ADD CONSTRAINT job_cost_scans_document_type_check
      CHECK (document_type IN ('invoice', 'credit_note'));
  END IF;
END $$;

-- Documents already on file keep reading as invoices, which is what they were
-- taken to be. A credit note among them shows negative lines either way; this
-- only changes how it is labelled, and only for ones scanned from now on.
COMMENT ON COLUMN job_cost_scans.document_type IS
  'invoice | credit_note — read off the document when it was scanned. See migration 099.';
