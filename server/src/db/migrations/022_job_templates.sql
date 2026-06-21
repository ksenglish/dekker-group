CREATE TABLE IF NOT EXISTS job_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100),
  description TEXT,
  priority VARCHAR(20) DEFAULT 'medium',
  is_recurring BOOLEAN DEFAULT false,
  recurrence_interval VARCHAR(20) DEFAULT 'annual',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
