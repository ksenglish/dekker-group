-- Xero accounting integration: push invoices out, pull payment/contact
-- updates back in. Follows the same external-id linkage pattern as the
-- ArcSite integration (migration 043).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS xero_contact_id VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_xero_contact_id
  ON customers(xero_contact_id) WHERE xero_contact_id IS NOT NULL;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_id VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_invoice_number VARCHAR(50);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_synced_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_xero_invoice_id
  ON invoices(xero_invoice_id) WHERE xero_invoice_id IS NOT NULL;

-- Dedup key for payments pulled in via webhook — Xero retries webhook
-- delivery (immediately, then every 15 min for up to 24h), and a payment
-- may already have been recorded manually before the webhook arrives.
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS xero_payment_id VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payments_xero_payment_id
  ON invoice_payments(xero_payment_id) WHERE xero_payment_id IS NOT NULL;
