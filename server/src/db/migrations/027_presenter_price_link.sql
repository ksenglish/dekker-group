-- Migration 027: Link presenter products to price list; hide subcategory labels
ALTER TABLE presenter_products ADD COLUMN IF NOT EXISTS price_list_product_id UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE presenter_subcategories ADD COLUMN IF NOT EXISTS hide_label BOOLEAN DEFAULT FALSE;
