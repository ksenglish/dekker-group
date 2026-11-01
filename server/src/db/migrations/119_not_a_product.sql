-- Lines off a supplier document that are not products and never will be.
--
-- Contracting hours. A skip bin. A monthly account fee. A takeoff. They are
-- real costs on real jobs and they are not things anybody can ever add to a
-- quote, but to the app they look exactly like a bracket it has not seen
-- before: a description and a price.
--
-- The guesses already made — freight, rounding, a credit note, a
-- sub-contractor's labour — catch the common ones by rule. They cannot catch
-- "Weekly Contracting Hours", because nothing about it says it is not a
-- product except knowing the business.
--
-- So somebody says so once, and it is remembered: off the New Line Items list,
-- and not added to the price list when its document is filed.

CREATE TABLE IF NOT EXISTS price_list_ignored_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What the line said, as the scan read it. Matched the way the price list
  -- matches anything: ignoring case and surrounding space.
  description TEXT NOT NULL,
  -- Kept for the record rather than for matching. The same words from the
  -- same supplier are the same non-product whatever code sat beside them.
  sku         VARCHAR(100),
  supplier    VARCHAR(255),
  dismissed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS price_list_ignored_lines_description
  ON price_list_ignored_lines (LOWER(TRIM(description)));

COMMENT ON TABLE price_list_ignored_lines IS
  'Invoice lines somebody has said are not products. Kept off New Line Items '
  'and out of the automatic price-list intake. See migration 119.';
