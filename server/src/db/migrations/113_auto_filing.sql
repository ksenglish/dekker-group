-- Filing a scanned document into a folder without somebody doing it by hand.
--
-- Statements and invoices arrive in the office mailbox all day and someone
-- opens PDF Check and puts each one in its folder. The folders already say
-- where they go — Statements/Bunnings, Invoices/ITM — and so does every
-- document filed so far, which is months of somebody deciding correctly.
--
-- What was missing was the kind of document. A supplier name alone cannot tell
-- a statement from an invoice, and those live in different folders.

-- document_type already exists (migration 099), where it meant one of two
-- things: an invoice, or a credit note that should read as a credit rather
-- than as a row of minus signs. A statement and a remittance are neither, and
-- both turn up in the mailbox constantly, so the column has to hold them.
ALTER TABLE job_cost_scans DROP CONSTRAINT IF EXISTS job_cost_scans_document_type_check;
ALTER TABLE job_cost_scans ADD CONSTRAINT job_cost_scans_document_type_check
  CHECK (document_type IN ('invoice', 'credit_note', 'statement', 'remittance', 'other'));

-- "We could not tell" is now a thing the column can say. It was NOT NULL with
-- a default of 'invoice', which was fine while every scan was one, but calling
-- an unread document an invoice is asserting something nobody checked — and
-- filing acts on this. Everything that reads it already copes: the price-list
-- report COALESCEs to 'invoice', and the job costs path coerces.
ALTER TABLE job_cost_scans ALTER COLUMN document_type DROP NOT NULL;

-- Where the app thinks it goes when it is not sure enough to act. Shown on the
-- PDF Check row so filing is one press rather than a hunt through the tree.
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS suggested_folder_id UUID
  REFERENCES cost_folders(id) ON DELETE SET NULL;

-- Filed by the app rather than by a person, and when. Kept apart so a wrong
-- one can be found and put back, and so nobody is left wondering who moved it.
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS filed_automatically BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS filed_at TIMESTAMPTZ;

-- Why it went where it went, in words, so the row can explain itself.
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS filed_because TEXT;

-- The lookup the filing decision makes: everything already filed, by supplier.
CREATE INDEX IF NOT EXISTS job_cost_scans_filed_supplier
  ON job_cost_scans (LOWER(TRIM(supplier)), document_type)
  WHERE folder_id IS NOT NULL AND supplier IS NOT NULL;

COMMENT ON COLUMN job_cost_scans.document_type IS
  'invoice | credit_note | statement | remittance | other, or null when it could '
  'not be told. Read off the document by the scanner. See migrations 099 and 113.';
