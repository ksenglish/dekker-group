-- Stores scanned supplier documents (image + metadata)
CREATE TABLE IF NOT EXISTS job_cost_scans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  document_base64 TEXT,
  mime_type    VARCHAR(100) DEFAULT 'image/jpeg',
  gst_treatment VARCHAR(20) DEFAULT 'exclusive',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Individual cost line items (separate from billable line_items)
CREATE TABLE IF NOT EXISTS job_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  scan_id      UUID REFERENCES job_cost_scans(id) ON DELETE SET NULL,
  description  TEXT NOT NULL,
  quantity     NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price   INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_costs_job_id ON job_costs(job_id);
CREATE INDEX IF NOT EXISTS idx_job_cost_scans_job_id ON job_cost_scans(job_id);
