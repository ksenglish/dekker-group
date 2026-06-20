CREATE TABLE IF NOT EXISTS presenter_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) DEFAULT '#1e40af',
  icon VARCHAR(10) DEFAULT '🏠',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS presenter_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES presenter_sections(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  image_base64 TEXT,
  price_from INTEGER DEFAULT 0,
  features TEXT[],
  calculator_type VARCHAR(50) DEFAULT 'area',
  calculator_config JSONB DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default sections
INSERT INTO presenter_sections (name, color, icon, sort_order) VALUES
  ('Dekker Air',         '#0ea5e9', '❄️', 1),
  ('Dekker Landscaping', '#16a34a', '🌿', 2),
  ('Dekker Fencing',     '#92400e', '🪵', 3),
  ('Renovations',        '#7c3aed', '🏠', 4)
ON CONFLICT DO NOTHING;
