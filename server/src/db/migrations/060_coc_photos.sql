-- Photos taken on site, attached to the Electrical COC and rendered into the
-- certificate PDF ahead of the sign-off section.
CREATE TABLE IF NOT EXISTS job_coc_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  data_base64 TEXT NOT NULL,
  mime_type VARCHAR(100),
  caption VARCHAR(255),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_coc_photos_job ON job_coc_photos(job_id);

-- The certificate is emailed for record keeping the first time it's signed.
-- This stamp stops every later edit from firing another copy.
ALTER TABLE job_electrical_coc ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;
