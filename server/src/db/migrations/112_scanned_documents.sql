-- What the invoice scanner has already seen.
--
-- The scanner reads the office mailbox and posts what it finds. It knew it had
-- dealt with an email thread, which is not the same as knowing it had dealt
-- with an invoice: a supplier's PDF rides along on every reply in a thread, so
-- the same invoice went into the app two or three times, and the same document
-- forwarded into a new thread went in again.
--
-- So what is remembered is the document, not the email. Two ways, because they
-- catch different mistakes:
--
--   the file itself  — the identical PDF, however it arrived
--   supplier+number  — the same invoice re-sent as a freshly rendered PDF
--
-- Claimed before the invoice is read rather than after it is filed, so two runs
-- overlapping cannot both decide they are the one doing it.

CREATE TABLE IF NOT EXISTS scanned_documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 of the file's bytes, as the scanner computed it.
  fingerprint    TEXT NOT NULL,
  supplier       TEXT,
  invoice_number TEXT,
  -- Where it ended up, once known: a job, the inbox, or a failure.
  outcome        VARCHAR(20),
  job_id         UUID REFERENCES jobs(id) ON DELETE SET NULL,
  source         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per file. This is what makes claiming atomic.
CREATE UNIQUE INDEX IF NOT EXISTS scanned_documents_fingerprint
  ON scanned_documents (fingerprint);

-- The same invoice under a different file. Folded so that "INV-1234" and
-- "inv 1234" from the same supplier are one invoice.
CREATE INDEX IF NOT EXISTS scanned_documents_invoice
  ON scanned_documents (
    LOWER(TRIM(supplier)),
    UPPER(REGEXP_REPLACE(COALESCE(invoice_number, ''), '[^A-Za-z0-9]', '', 'g'))
  )
  WHERE supplier IS NOT NULL AND invoice_number IS NOT NULL;

-- Invoices already in the app from before any of this existed are known too,
-- so turning this on does not re-import a year of history.
CREATE INDEX IF NOT EXISTS job_cost_scans_invoice
  ON job_cost_scans (
    LOWER(TRIM(supplier)),
    UPPER(REGEXP_REPLACE(COALESCE(invoice_number, ''), '[^A-Za-z0-9]', '', 'g'))
  )
  WHERE supplier IS NOT NULL AND invoice_number IS NOT NULL;
