-- Migration 107: what has to be ordered for a job, and where from
--
-- A quote is accepted and somebody has to turn it into materials on a van. The
-- line items are written for the customer — "Supply & install bathroom
-- extractor" — and the person ordering needs the fan, the duct, the grille and
-- the fixings, each against the supplier who sells it.
--
-- So an accepted quote explodes into a materials list: a kit becomes its parts,
-- a proposal becomes the products it was priced from, and anything else stays
-- as it is.

-- Where a line on the materials list came from, so a regeneration can replace
-- what it produced without touching anything added by hand.
--   quote_line       — a product line on the quote, as it stands
--   kit_component    — a part of a BOM kit that was on the quote
--   proposal_product — a product line from a proposal the quote was raised from
--   manual           — somebody typed it in
CREATE TABLE IF NOT EXISTS job_materials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  description   TEXT NOT NULL,
  -- Snapshotted, not looked up: the supplier on the price list can change, and
  -- what matters is who it was ordered from for this job.
  supplier      VARCHAR(255),
  unit          VARCHAR(50),
  quantity      NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  source        VARCHAR(20) NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('quote_line', 'kit_component', 'proposal_product', 'manual')),
  source_quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  -- Where it is up to. Ordering sets this; the rest is for the office to tick.
  status        VARCHAR(20) NOT NULL DEFAULT 'needed'
                  CHECK (status IN ('needed', 'ordered', 'received', 'cancelled')),
  notes         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_materials_job_idx ON job_materials (job_id, sort_order);
CREATE INDEX IF NOT EXISTS job_materials_supplier_idx ON job_materials (job_id, supplier);

-- Who to send an order to. The supplier name already lives on every product as
-- free text; this is the small amount more that is needed to actually send
-- something — an address to email, and the account to quote.
CREATE TABLE IF NOT EXISTS suppliers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(255),
  phone          VARCHAR(50),
  account_ref    VARCHAR(100),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Matched on the name as it is spelled on the product, case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_key ON suppliers (LOWER(name));

-- An order placed with one supplier for one job: either picked up or delivered.
CREATE TABLE IF NOT EXISTS material_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  supplier      VARCHAR(255) NOT NULL,
  method        VARCHAR(20) NOT NULL CHECK (method IN ('collect', 'delivery')),
  -- When it is wanted: the collection day, or the delivery day.
  required_date DATE,
  -- Where a delivery goes. Snapshotted off the job at the time, because a job's
  -- site can be corrected later and the order has already been sent.
  deliver_to    TEXT,
  contact_name  VARCHAR(255),
  contact_phone VARCHAR(50),
  instructions  TEXT,
  email_to      VARCHAR(255),
  status        VARCHAR(20) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'failed')),
  reference     VARCHAR(50),
  sent_at       TIMESTAMPTZ,
  sent_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS material_orders_job_idx ON material_orders (job_id, created_at DESC);

-- What was on that order. The quantity is recorded here rather than read back
-- off the material, so an order already sent still says what was asked for even
-- if the list is edited afterwards.
CREATE TABLE IF NOT EXISTS material_order_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES material_orders(id) ON DELETE CASCADE,
  material_id   UUID REFERENCES job_materials(id) ON DELETE SET NULL,
  description   TEXT NOT NULL,
  unit          VARCHAR(50),
  quantity      NUMERIC(12,3) NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS material_order_lines_order_idx ON material_order_lines (order_id, sort_order);

-- Which proposal a quote line came from, so an accepted quote can be exploded
-- back into the products the price was built from. Without it a one-line
-- proposal ("Construct side fence — $759.61") is untraceable to its materials.
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS proposal_id UUID
  REFERENCES job_proposals(id) ON DELETE SET NULL;
