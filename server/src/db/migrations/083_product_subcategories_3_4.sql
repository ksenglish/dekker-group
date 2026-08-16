-- Migration 083: two further levels of subcategory
--
-- The price list is growing to roughly a thousand products, and two levels
-- leaves too many sitting in one folder to find anything. Four levels below
-- the category gives, for example:
--   Dekker Air > Ventilation > Extraction > Inline Fans > 150mm

ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory_3 VARCHAR(120);
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory_4 VARCHAR(120);

-- Replaces the two-level index from 082 so the browse tree stays covered all
-- the way down.
DROP INDEX IF EXISTS products_browse_idx;
CREATE INDEX IF NOT EXISTS products_browse_idx
  ON products (category, subcategory_1, subcategory_2, subcategory_3, subcategory_4)
  WHERE is_active = true;
