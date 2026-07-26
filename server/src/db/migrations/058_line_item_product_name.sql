-- Line items need two separate pieces of text: what the customer reads on the
-- quote, and the supplier's product code used when ordering.
--
--   description  -> customer-facing (e.g. "Rinnai 3.5COOL/4.0HEAT WIFI")
--   product_name -> internal ordering code (e.g. "HSNRTX35"), never shown
--                   on the customer's quote
--
-- Picking a product used to write its NAME into description, which is why
-- codes were showing up on quotes.

ALTER TABLE line_items ADD COLUMN IF NOT EXISTS product_name TEXT;

-- Carry the code across from the linked price list product.
UPDATE line_items li
SET product_name = p.name
FROM products p
WHERE p.id = li.product_id AND li.product_name IS NULL;

-- Move existing rows over to the product's description. Only where the text
-- still exactly matches the product name — that means it was auto-filled when
-- the product was picked, so it's safe to replace. Anything someone typed or
-- edited by hand is left untouched.
UPDATE line_items li
SET description = p.description
FROM products p
WHERE p.id = li.product_id
  AND li.description = p.name
  AND NULLIF(TRIM(p.description), '') IS NOT NULL;
