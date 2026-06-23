-- Billing rates stored in settings table as JSON (key = 'billing_rates')
-- Google Maps API key stored in settings table (key = 'integrations')
-- Job site address lat/lng for map pins
ALTER TABLE customer_sites ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE customer_sites ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- Also allow jobs to have a freeform site address if no site is linked
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_address TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_lat DOUBLE PRECISION;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_lng DOUBLE PRECISION;
