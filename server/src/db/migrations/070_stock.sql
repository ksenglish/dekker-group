-- Stock tracking: what we hold, and where.
--
-- Stock lives in named locations — the warehouse, plus one row per van — so a
-- van survives changing hands between techs and can be shared by several.

CREATE TABLE IF NOT EXISTS stock_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(120) NOT NULL,
  type       VARCHAR(20) NOT NULL CHECK (type IN ('warehouse', 'van')),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Who drives which van. Many-to-many on purpose: vans get shared, and people
-- swap between them. The scanner uses this to default someone to their van.
CREATE TABLE IF NOT EXISTS stock_location_users (
  location_id UUID NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (location_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_location_users_user ON stock_location_users(user_id);

-- A product can carry several codes: the maker's barcode off the box, and/or
-- one of our own printed labels for loose or unbarcoded items. Codes are
-- globally unique so a scan resolves to exactly one product.
CREATE TABLE IF NOT EXISTS product_barcodes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code       VARCHAR(64) NOT NULL UNIQUE,
  source     VARCHAR(20) NOT NULL DEFAULT 'supplier' CHECK (source IN ('supplier', 'internal')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_barcodes_product ON product_barcodes(product_id);

-- Quantity on hand. Numeric rather than integer so part units (2.5 m of duct)
-- are representable.
CREATE TABLE IF NOT EXISTS stock_levels (
  location_id UUID NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (location_id, product_id)
);

-- Every movement, kept as an audit trail. from/to are both nullable: receiving
-- has no source, using on a job has no destination.
CREATE TABLE IF NOT EXISTS stock_movements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_location_id UUID REFERENCES stock_locations(id) ON DELETE SET NULL,
  to_location_id   UUID REFERENCES stock_locations(id) ON DELETE SET NULL,
  job_id           UUID REFERENCES jobs(id) ON DELETE SET NULL,
  quantity         NUMERIC(12,2) NOT NULL,
  reason           VARCHAR(30) NOT NULL CHECK (reason IN ('receive', 'transfer', 'used_on_job', 'adjust')),
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_job ON stock_movements(job_id);

-- There is exactly one warehouse to begin with; vans are added in the app.
INSERT INTO stock_locations (name, type)
SELECT 'Warehouse', 'warehouse'
WHERE NOT EXISTS (SELECT 1 FROM stock_locations WHERE type = 'warehouse');
