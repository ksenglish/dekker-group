-- Migration 004: Add product_id to line_items
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
