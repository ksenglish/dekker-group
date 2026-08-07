-- Track note edits. Left NULL for notes that have never been edited, so the UI
-- can show an "edited" marker without guessing from created_at.
ALTER TABLE job_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
