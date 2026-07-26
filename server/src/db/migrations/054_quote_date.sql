-- Editable "Quote Date" (a la Tradify), separate from the immutable
-- created_at audit timestamp, so sales can back/forward-date a quote
-- without touching its actual creation record.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_date DATE;
UPDATE quotes SET quote_date = created_at::date WHERE quote_date IS NULL;
ALTER TABLE quotes ALTER COLUMN quote_date SET DEFAULT CURRENT_DATE;
