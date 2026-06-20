-- Migration 018: Add brochure_base64 to products for full-page quote appendix
ALTER TABLE products ADD COLUMN IF NOT EXISTS brochure_base64 TEXT;
