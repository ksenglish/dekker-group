-- Migration 082: two levels of subcategory on the price list
--
-- Products are browsed as Category > Sub Category 1 > Sub Category 2, e.g.
-- IP44 VAFT150S is Dekker Air > Ventilation > Extraction. Kept as two plain
-- columns rather than a category table: they arrive as two columns in the
-- import CSV, and a lookup table would mean reconciling names on every import
-- for no gain — nothing else refers to a category by id.

ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory_1 VARCHAR(120);
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory_2 VARCHAR(120);

-- Drives the browse tree, which always filters on active products.
CREATE INDEX IF NOT EXISTS products_browse_idx
  ON products (category, subcategory_1, subcategory_2)
  WHERE is_active = true;
