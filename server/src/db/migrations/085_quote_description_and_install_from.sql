-- Migration 085: quote wording on the price list, and a headline install price
--
-- Two separate descriptions on a product now:
--   description       — the line on the quote ("Paling Fence 1.8m High")
--   quote_description — the wording added to the quote's description box
-- Both arrive as columns in the price list import.
ALTER TABLE products ADD COLUMN IF NOT EXISTS quote_description TEXT;

-- The "Installation from" figure shown in the Sales Presenter and on the
-- website. Kept separate from the install product's own rate: that rate is what
-- gets charged, this is the indicative number quoted to a customer before
-- anyone has seen the job.
ALTER TABLE presenter_products ADD COLUMN IF NOT EXISTS install_from_cents INTEGER;
