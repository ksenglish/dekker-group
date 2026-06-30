-- Migration 033: Track quote creator for per-user filtering
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_created_by ON quotes(created_by);
