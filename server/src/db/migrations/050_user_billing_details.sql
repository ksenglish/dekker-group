-- Supplier details for Buyer Created Invoices — a BCI has to show the
-- supplier's name, address and (when they're registered) their GST number.
ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gst_number VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS gst_registered BOOLEAN NOT NULL DEFAULT false;
