-- The same brochure often covers a whole product range — the Mitsubishi AP
-- Classic sheet is uploaded against the AP25, AP50, AP71 and so on. The quote
-- PDF already collapses those to one copy because it dedupes on the brochure's
-- actual bytes, but the public/preview page only had a per-product URL to go
-- on, so it showed the same brochure once per product.
--
-- A stored content hash gives that page the same identity to dedupe on without
-- pulling every brochure out of object storage on each page load.
ALTER TABLE products ADD COLUMN IF NOT EXISTS brochure_hash VARCHAR(32);

-- Brochures still held inline can be hashed right here. Ones in object storage
-- are filled in lazily the first time a quote showing them is opened.
UPDATE products
   SET brochure_hash = md5(brochure_base64)
 WHERE brochure_base64 IS NOT NULL
   AND brochure_hash IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_brochure_hash
  ON products(brochure_hash) WHERE brochure_hash IS NOT NULL;
