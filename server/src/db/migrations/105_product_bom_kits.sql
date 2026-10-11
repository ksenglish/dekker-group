-- Migration 105: BOM kits — a price-list product made up of other products
--
-- "Supply & install bathroom extractor" is a fan, a length of duct, a grille,
-- a switch and the fixings. Priced by hand it drifts the moment any one of
-- those changes; priced from its parts it is right by construction, and the
-- quote still shows the single line the customer wants to read.
CREATE TABLE IF NOT EXISTS product_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The kit.
  parent_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- What goes in it. RESTRICT, not CASCADE: deleting a product that is part of
  -- a kit would silently change that kit's price, so the API blocks it and
  -- says which kits are using it.
  component_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- One row per component per kit; two of the same thing is a quantity of 2.
  UNIQUE (parent_id, component_id),
  -- A kit cannot contain itself. Deeper cycles are caught in the API, which
  -- can walk the tree; this catches the obvious one at the database.
  CHECK (parent_id <> component_id)
);

CREATE INDEX IF NOT EXISTS idx_product_components_parent ON product_components(parent_id);
CREATE INDEX IF NOT EXISTS idx_product_components_component ON product_components(component_id);

COMMENT ON TABLE product_components IS
  'What a BOM kit is made of. The kit''s own cost_price and unit_price are '
  'rolled up from these on save. See migration 105.';
