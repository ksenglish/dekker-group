-- Migration 019: Presenter subcategories + section images
ALTER TABLE presenter_sections ADD COLUMN IF NOT EXISTS image_base64 TEXT;

CREATE TABLE IF NOT EXISTS presenter_subcategories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES presenter_sections(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  image_base64 TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE presenter_products ADD COLUMN IF NOT EXISTS subcategory_id UUID REFERENCES presenter_subcategories(id) ON DELETE SET NULL;
