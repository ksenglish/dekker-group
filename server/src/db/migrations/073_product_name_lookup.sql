-- Imports match an existing product by name, case- and whitespace-insensitively,
-- so give that lookup an index to sit on.
--
-- Deliberately NOT unique: the price list may already hold duplicates created by
-- earlier imports, and a unique index would fail to build against live data.
-- Deduplicating would also have to decide what happens to line items, quotes and
-- barcodes pointing at the losing row, which is not something an import should
-- do behind anyone's back.
CREATE INDEX IF NOT EXISTS idx_products_name_lookup ON products (LOWER(TRIM(name)));
