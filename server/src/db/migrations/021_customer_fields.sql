-- Migration 021: Add mobile, contact_name, lead_source and structured address to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS mobile VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lead_source VARCHAR(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_street VARCHAR(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_city VARCHAR(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_region VARCHAR(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_postcode VARCHAR(20);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_country VARCHAR(100) DEFAULT 'New Zealand';
