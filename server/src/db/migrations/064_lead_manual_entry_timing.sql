-- Manual lead entry (same fields as a new customer) + conversion timing, so
-- every lead can be tracked from arrival through to its result regardless of
-- whether it came from a website form or was typed in by the office.

-- Contact fields, mirroring the customer record a lead converts into
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_name     VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS company          VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS mobile           VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address_street   TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address_city     VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address_region   VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address_postcode VARCHAR(20);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address_country  VARCHAR(100) DEFAULT 'New Zealand';

-- How the lead arrived, and who entered it if typed in manually
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entry_method VARCHAR(20) NOT NULL DEFAULT 'website';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_entry_method_check
    CHECK (entry_method IN ('website', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Result timing. resulted_at is the first move off 'new' — the "how long did we
-- take to action this" clock. The per-status stamps let a report separate time
-- to first contact from time to a won job.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS resulted_at  TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS resulted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Backfill already-resulted leads. updated_at is the only signal we have for
-- when they were actioned, so averages over historic leads are approximate.
UPDATE leads SET resulted_at  = updated_at WHERE status <> 'new'      AND resulted_at  IS NULL;
UPDATE leads SET contacted_at = updated_at WHERE status = 'contacted' AND contacted_at IS NULL;
UPDATE leads SET converted_at = updated_at WHERE status = 'converted' AND converted_at IS NULL;
UPDATE leads SET dismissed_at = updated_at WHERE status = 'dismissed' AND dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_resulted_at ON leads(resulted_at);
CREATE INDEX IF NOT EXISTS idx_leads_entry_method ON leads(entry_method);
