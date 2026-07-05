-- Website leads (e.g. Dekker Air contact form submissions)
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  service_required VARCHAR(255),
  message TEXT,
  source VARCHAR(255),                -- e.g. 'Dekker Air-Website-Main Page'
  status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'converted', 'dismissed')),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,  -- set when converted
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
