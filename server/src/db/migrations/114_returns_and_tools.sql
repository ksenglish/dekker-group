-- Two things a stock take needs.
--
-- First: material charged to a job that never went on it. Somebody buys ten
-- lengths, uses seven, and three go back in the van — but the job has been
-- charged for ten ever since, and the three are in nobody's count. Putting
-- them back is a movement like any other, and wants its own reason so a stock
-- take can tell a return from a delivery.
--
-- Second: tools. They live in the same places as stock and move between them
-- the same way, so they are held the same way — but they are not consumables,
-- and a van's stock figure should not quietly include its drills.

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('receive', 'transfer', 'used_on_job', 'adjust', 'returned_from_job'));

-- material | tool. A tool is counted, valued and moved like stock, and shown
-- apart from it: "the van holds $900 of materials and $4,200 of tools" is two
-- facts, and adding them together answers neither question.
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_kind VARCHAR(10) NOT NULL DEFAULT 'material';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_kind_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_stock_kind_check
      CHECK (stock_kind IN ('material', 'tool'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS products_stock_kind ON products (stock_kind) WHERE stock_kind <> 'material';

-- Anything already filed under a Tools category is one, so the first stock
-- take does not start by re-labelling the drills by hand. Matched on the
-- category as it is actually spelled on the price list.
UPDATE products
   SET stock_kind = 'tool'
 WHERE stock_kind = 'material'
   AND (
     LOWER(COALESCE(category, '')) LIKE '%tool%'
     OR LOWER(COALESCE(subcategory_1, '')) LIKE '%tool%'
     OR LOWER(COALESCE(subcategory_2, '')) LIKE '%tool%'
   );

-- How much of a cost line went back to stock.
--
-- The line's own quantity comes down by the same amount, so every total that
-- already adds up a job's costs is right without being changed — and there are
-- seven of them. This column is what stops the reduction being silent: with
-- both, the row still says what the invoice said.
ALTER TABLE job_costs ADD COLUMN IF NOT EXISTS returned_quantity NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN products.stock_kind IS
  'material | tool. Tools are counted and valued separately from consumable '
  'stock, in the same locations. See migration 114.';
