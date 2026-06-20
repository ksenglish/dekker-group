ALTER TABLE quotes ADD COLUMN IF NOT EXISTS public_token UUID DEFAULT gen_random_uuid();
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS accepted_name VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_public_token ON quotes(public_token);
