-- Sub-contractors, and telling their invoices apart from a merchant's.
--
-- Both arrive as a PDF with a job number on it and both are a cost on that
-- job, but they are not the same kind of cost and lumping them together hides
-- the one figure anybody actually wants: what we paid other people to do work
-- against what we spent on materials.
--
-- They also must not reach the price list. A sparky's invoice line reads
-- "Install 3 x downlights — 4 hrs"; that is labour on one job, not a product
-- anybody can ever buy again, and the price list filling up with them would
-- make it useless.

CREATE TABLE IF NOT EXISTS subcontractors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  trade         VARCHAR(120),
  contact_name  VARCHAR(255),
  email         VARCHAR(255),
  phone         VARCHAR(60),
  gst_number    VARCHAR(40),
  -- The other names they invoice under. A one-man band bills as his own name
  -- one month and his company's the next, and both are the same sparky.
  also_known_as TEXT[] NOT NULL DEFAULT '{}',
  notes         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per business, however the name is capitalised or spaced.
CREATE UNIQUE INDEX IF NOT EXISTS subcontractors_name
  ON subcontractors (LOWER(TRIM(name)));

-- The GST number is the only thing on an invoice that identifies a business
-- beyond argument, so where one is held it is matched on first. Partial, so
-- the many with no number recorded do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS subcontractors_gst
  ON subcontractors (REGEXP_REPLACE(COALESCE(gst_number, ''), '[^0-9]', '', 'g'))
  WHERE gst_number IS NOT NULL AND TRIM(gst_number) <> '';

-- material | subcontractor. On the document, because it is a fact about who
-- sent it…
ALTER TABLE job_cost_scans
  ADD COLUMN IF NOT EXISTS cost_kind VARCHAR(20) NOT NULL DEFAULT 'material';

-- …and on the line, because that is what the Costs tab adds up. Carried on
-- both rather than joined for every total: a line can exist with no document
-- behind it (stock off a van, or an invoice since deleted) and still has to
-- land under the right heading.
ALTER TABLE job_costs
  ADD COLUMN IF NOT EXISTS cost_kind VARCHAR(20) NOT NULL DEFAULT 'material';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_cost_scans_cost_kind_check') THEN
    ALTER TABLE job_cost_scans ADD CONSTRAINT job_cost_scans_cost_kind_check
      CHECK (cost_kind IN ('material', 'subcontractor'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_costs_cost_kind_check') THEN
    ALTER TABLE job_costs ADD CONSTRAINT job_costs_cost_kind_check
      CHECK (cost_kind IN ('material', 'subcontractor'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS job_costs_kind ON job_costs (job_id, cost_kind);

COMMENT ON COLUMN job_costs.cost_kind IS
  'material | subcontractor. Sub-contractor lines are totalled separately on '
  'the Costs tab and never reach the price list. See migration 116.';
