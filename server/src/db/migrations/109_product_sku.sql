-- Migration 109: a supplier's own code for a product, on both sides
--
-- The price list has only ever identified a product by its name, and names are
-- the one thing a supplier writes differently every time. "MSZ-AP35VGKD2
-- SMART", "MSZ AP35VGKD2" and "Mitsubishi AP35 Smart Hi-Wall" are one product
-- and three rows, each carrying its own price — and whichever one happens to
-- be picked on a quote is the price the customer gets.
--
-- A code does not drift like that. It is printed on the invoice, it is what
-- the supplier uses to identify the thing, and it is stable.
ALTER TABLE products  ADD COLUMN IF NOT EXISTS sku TEXT;
-- Carried on the cost line too, so an invoice can be matched back to the
-- product it bought rather than guessed at from the description.
ALTER TABLE job_costs ADD COLUMN IF NOT EXISTS sku TEXT;

-- Matching is done case-insensitively and with surrounding space ignored,
-- because a code read off a scanned invoice arrives however the page had it.
CREATE INDEX IF NOT EXISTS idx_products_sku
  ON products (LOWER(TRIM(sku))) WHERE sku IS NOT NULL AND sku <> '';
CREATE INDEX IF NOT EXISTS idx_products_name_lower
  ON products (LOWER(TRIM(name)));
CREATE INDEX IF NOT EXISTS idx_job_costs_sku
  ON job_costs (LOWER(TRIM(sku))) WHERE sku IS NOT NULL AND sku <> '';

-- Deliberately not a unique constraint. Two suppliers can and do use the same
-- code for different things, so uniqueness belongs with the supplier rather
-- than with the code alone — and that is a judgement the application makes
-- when it matches, where it can fall back to the name. A constraint here
-- would reject a legitimate second supplier's product outright.
COMMENT ON COLUMN products.sku IS
  'The supplier''s own code for this product. Matched within a supplier; see '
  'matchProduct in server/src/services/productMatch.js. Migration 109.';
