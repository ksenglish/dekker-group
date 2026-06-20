-- Migration 020: Allow nested subcategories via self-referential parent_id
ALTER TABLE presenter_subcategories ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES presenter_subcategories(id) ON DELETE CASCADE;
