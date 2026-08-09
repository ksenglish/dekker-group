-- Quotes can now be raised before a job exists — a prospect is priced up front
-- and the job (with its number) is only opened once the work is won, or the
-- quote is linked to a job that already covers it.
--
-- quotes.job_id was already nullable (migration 034), but a quote's line items
-- were not: line_items.job_id has been NOT NULL since the initial schema, back
-- when every line item hung off a job. A job-less quote's items have nowhere to
-- point, so that requirement has to go.

ALTER TABLE line_items ALTER COLUMN job_id DROP NOT NULL;

-- Nothing else changes though: an item still has to belong to *something*, or
-- it's an orphan no query would ever find.
ALTER TABLE line_items DROP CONSTRAINT IF EXISTS line_items_has_parent;
ALTER TABLE line_items ADD CONSTRAINT line_items_has_parent
  CHECK (job_id IS NOT NULL OR quote_id IS NOT NULL);
