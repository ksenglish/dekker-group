-- Sequential numbers for quotes and invoices
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_number SERIAL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number SERIAL;

-- Delivery status tracking
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'unsent';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'unsent';

-- Cancelled status (already supported by VARCHAR status field)
-- Mark existing sent/accepted/declined quotes as having been sent
UPDATE quotes SET delivery_status = 'sent' WHERE status IN ('sent', 'accepted', 'declined') AND delivery_status = 'unsent';
UPDATE invoices SET delivery_status = 'sent' WHERE status IN ('sent', 'paid') AND delivery_status = 'unsent';
