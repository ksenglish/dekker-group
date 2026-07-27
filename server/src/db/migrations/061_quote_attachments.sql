-- Quotes used to pull in every ArcSite drawing on their job at render time,
-- so a drawing added later turned up on quotes sent weeks earlier. Each quote
-- now picks its own drawings and photos.
CREATE TABLE IF NOT EXISTS quote_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES job_attachments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quote_id, attachment_id)
);
CREATE INDEX IF NOT EXISTS idx_quote_attachments_quote ON quote_attachments(quote_id);

-- Lock in what each existing quote currently displays — its job's ArcSite
-- drawings as they stand right now — rather than having them all go blank or
-- keep drifting as new drawings are pulled.
INSERT INTO quote_attachments (quote_id, attachment_id)
SELECT q.id, a.id
FROM quotes q
JOIN job_attachments a ON a.job_id = q.job_id AND a.arcsite_drawing_id IS NOT NULL
ON CONFLICT (quote_id, attachment_id) DO NOTHING;
