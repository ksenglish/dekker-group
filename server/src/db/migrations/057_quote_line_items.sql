-- Line items used to hang off the job alone, so every quote on a job shared
-- one set — you couldn't price two options for the same customer, and editing
-- a quote silently rewrote the job. Quotes now own their own copies.
--
--   quote_id IS NULL  -> the job's own line items (what gets invoiced)
--   quote_id = <id>   -> that quote's line items
--
-- Accepting a quote copies its items back onto the job.

ALTER TABLE line_items ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_line_items_quote ON line_items(quote_id);

-- Give every existing quote a snapshot of its job's current line items. Those
-- are exactly what each quote already displays today (it read them straight
-- off the job), so nothing changes visually — they're just frozen from here
-- on instead of drifting whenever the job is edited.
INSERT INTO line_items (job_id, quote_id, description, quantity, unit_price, product_id, created_at)
SELECT li.job_id, q.id, li.description, li.quantity, li.unit_price, li.product_id, li.created_at
FROM quotes q
JOIN line_items li ON li.job_id = q.job_id AND li.quote_id IS NULL
WHERE NOT EXISTS (SELECT 1 FROM line_items existing WHERE existing.quote_id = q.id);
