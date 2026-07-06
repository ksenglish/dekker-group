-- Dekker Air website forms collect an address — capture it on leads too
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address TEXT;
